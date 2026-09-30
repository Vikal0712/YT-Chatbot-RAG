import json
import logging
import os
import re
import subprocess
import threading
import time
from functools import lru_cache
from urllib import error, request

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from youtube_transcript_api import YouTubeTranscriptApi

from config import (
    EMBEDDING_MODEL,
    LLAMA_HOST,
    LLAMA_PORT,
    LLAMA_SERVER_EXE,
    LLAMA_URL,
    LLM_MODEL_PATH,
)


_llama_process = None
_llama_start_lock = threading.Lock()
logger = logging.getLogger("yt_rag")


@lru_cache(maxsize=1)
def _get_embedding_model():
    """Load the embedding model once, on the first embedding request."""
    return SentenceTransformer(EMBEDDING_MODEL, device="cpu")


def extract_video_id(url):
    patterns = [
        r"(?:v=|/)([0-9A-Za-z_-]{11})(?:[?&/].*)?$",
        r"youtu\.be/([0-9A-Za-z_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def get_transcript_with_language(video_id):
    """Prefer English captions, then YouTube's English translation if available."""
    ytt_api = YouTubeTranscriptApi()
    try:
        transcript = ytt_api.fetch(video_id, languages=["en"])
        return " ".join(snippet.text for snippet in transcript), "en"
    except Exception as english_error:
        logger.info("No English transcript for video_id=%s: %s", video_id, english_error)

    try:
        available = list(ytt_api.list(video_id))
        if not available:
            logger.warning("No transcript tracks found for video_id=%s", video_id)
            return None, None

        english_track = next(
            (track for track in available if track.language_code.lower().startswith("en")),
            None,
        )
        if english_track is not None:
            transcript = english_track.fetch()
            return " ".join(snippet.text for snippet in transcript), english_track.language_code

        translatable_track = next(
            (track for track in available if track.is_translatable), None
        )
        if translatable_track is not None:
            try:
                translated = translatable_track.translate("en").fetch()
                logger.info(
                    "Using YouTube English translation for video_id=%s source_language=%s",
                    video_id,
                    translatable_track.language_code,
                )
                return " ".join(snippet.text for snippet in translated), "en"
            except Exception:
                logger.exception(
                    "YouTube translation failed for video_id=%s source_language=%s",
                    video_id,
                    translatable_track.language_code,
                )

        source_track = available[0]
        transcript = source_track.fetch()
        logger.warning(
            "Using original transcript language=%s for video_id=%s; no English translation is available",
            source_track.language_code,
            video_id,
        )
        return " ".join(snippet.text for snippet in transcript), source_track.language_code
    except Exception as exc:
        logger.exception("Transcript fetch failed for video_id=%s", video_id)
        raise RuntimeError(
            "YouTube did not provide a usable transcript for this video. "
            "Check that captions are enabled and that the video is publicly accessible. "
            f"Details: {exc}"
        ) from exc


def get_transcript(video_id):
    """Backward-compatible text-only transcript helper."""
    transcript, _ = get_transcript_with_language(video_id)
    return transcript


def split_text(text, chunk_size=150):
    words = text.split()
    return [
        " ".join(words[i : i + chunk_size])
        for i in range(0, len(words), chunk_size)
    ]


def create_embeddings(text_list):
    embeddings = _get_embedding_model().encode(
        text_list,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return np.asarray(embeddings, dtype="float32")


def release_embedding_model():
    """Drop model weights after indexing/encoding to leave RAM for generation."""
    _get_embedding_model.cache_clear()
    import gc

    gc.collect()


def build_faiss_index(embeddings):
    embeddings = np.asarray(embeddings, dtype="float32")
    if embeddings.ndim != 2 or embeddings.shape[0] == 0:
        raise ValueError("At least one embedding is required to build the FAISS index")
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)
    return index


def search_chunks(index, query_embedding, k=3):
    if index.ntotal == 0:
        return np.array([], dtype="float32"), np.array([], dtype="int64")
    distances, indices = index.search(
        np.asarray([query_embedding], dtype="float32"), min(k, index.ntotal)
    )
    valid = indices[0] >= 0
    return distances[0][valid], indices[0][valid]


def retrieve_chunks(index, query_embedding, k=3):
    _, indices = search_chunks(index, query_embedding, k)
    return indices


def _llama_server_ready():
    try:
        with request.urlopen(f"{LLAMA_URL}/health", timeout=2) as response:
            return response.status == 200
    except error.URLError:
        return False


def _ensure_llama_server():
    global _llama_process

    if _llama_server_ready():
        return

    with _llama_start_lock:
        if _llama_server_ready():
            return
        if not LLAMA_SERVER_EXE.is_file():
            raise RuntimeError(
                f"llama-server.exe was not found at {LLAMA_SERVER_EXE}"
            )
        if not LLM_MODEL_PATH.is_file():
            raise RuntimeError(f"Local LLM model was not found at {LLM_MODEL_PATH}")

        startupinfo = None
        creationflags = 0
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            creationflags = subprocess.CREATE_NO_WINDOW

        _llama_process = subprocess.Popen(
            [
                str(LLAMA_SERVER_EXE),
                "--model",
                str(LLM_MODEL_PATH),
                "--host",
                LLAMA_HOST,
                "--port",
                str(LLAMA_PORT),
                "--ctx-size",
                "4096",
                "--threads",
                "2",
                "--parallel",
                "1",
            ],
            cwd=str(LLAMA_SERVER_EXE.parent),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )

        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if _llama_process.poll() is not None:
                raise RuntimeError(
                    f"llama-server stopped during startup (exit code {_llama_process.returncode})"
                )
            if _llama_server_ready():
                return
            time.sleep(0.5)
        raise RuntimeError("llama-server did not finish loading the local model within 120 seconds")


def shutdown_llama_server():
    """Stop the llama.cpp process when this backend started it."""
    global _llama_process

    with _llama_start_lock:
        if _llama_process is None or _llama_process.poll() is not None:
            return

        _llama_process.terminate()
        try:
            _llama_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _llama_process.kill()
            _llama_process.wait(timeout=5)
        finally:
            _llama_process = None


def ask_llm(context, question):
    if not context.strip():
        return "Sorry, I couldn't find relevant information in the video transcript."

    is_highlights_request = any(
        phrase in question.lower()
        for phrase in ("highlight", "summary", "summarize", "summarise", "key points", "main points")
    )
    if is_highlights_request:
        task_instructions = (
            "Give up to three numbered highlights in the order they appear in the transcript. "
            "Use one short, complete sentence per highlight, and make each point cover a different topic. "
            "Include only clear facts stated in the transcript. Leave out ambiguous details instead of guessing. "
            "Do not repeat facts or add outside information."
        )
    else:
        task_instructions = (
            "Answer the question directly in one or two complete sentences. "
            "Use only details supported by the transcript. Do not guess or add outside facts."
        )

    prompt = f"""<|im_start|>system
You answer questions about a video transcript. The transcript may contain speech-recognition mistakes. Answer in English. {task_instructions}
If the transcript does not support an answer, say that clearly. Finish every sentence and complete every numbered point.
<|im_end|>
<|im_start|>user
Transcript context:
{context[:3800]}

Question: {question}
<|im_end|>
<|im_start|>assistant
"""

    _ensure_llama_server()
    answer, result = _request_completion(prompt)
    if not answer:
        raise RuntimeError("llama.cpp returned an empty answer")

    # If llama.cpp reaches the token cap, ask it to continue instead of returning
    # an answer that may end halfway through a sentence or numbered point.
    for _ in range(2):
        if result.get("stop_type") != "limit":
            break
        continuation_prompt = f"""<|im_start|>system
Continue the draft answer using only the transcript. Do not repeat any text already written. Finish the current sentence and all remaining numbered points.
<|im_end|>
<|im_start|>user
Transcript context:
{context[:1800]}

Question: {question}

Draft answer so far:
{answer}

Continue the answer from where it stops:
<|im_end|>
<|im_start|>assistant
"""
        continuation, result = _request_completion(continuation_prompt)
        answer = f"{answer.rstrip()} {continuation.lstrip()}".strip()
        if not continuation:
            break

    if result.get("stop_type") == "limit":
        raise RuntimeError(
            "The local model reached its response limit before finishing. "
            "Try asking a shorter question."
        )
    if is_highlights_request:
        answer = _keep_complete_highlights(answer)
    return answer


def _request_completion(prompt):
    payload = {
        "prompt": prompt,
        "n_predict": 512,
        "temperature": 0.0,
        "stop": ["<|im_end|>", "<|endoftext|>"],
    }
    req = request.Request(
        f"{LLAMA_URL}/completion",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=240) as response:
            result = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"llama.cpp returned HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(
            f"Could not connect to the local llama.cpp server at {LLAMA_URL}. "
            f"Details: {exc.reason}"
        ) from exc

    if result.get("truncated"):
        raise RuntimeError(
            "The transcript context exceeded the local model's context window. "
            "Try a shorter question."
        )
    return result.get("content", "").strip(), result


def _keep_complete_highlights(answer, limit=3):
    markers = list(re.finditer(r"(?m)^\s*\d+[.)]\s*", answer))
    if not markers:
        return answer

    points = []
    for position, marker in enumerate(markers[:limit]):
        end = markers[position + 1].start() if position + 1 < len(markers) else len(answer)
        point = answer[marker.end() : end].strip()
        if re.search(r"[.!?][\"'”’)]?$", point):
            points.append(point)

    if not points:
        raise RuntimeError(
            "The local model did not finish a complete highlight. Try asking again."
        )
    return "\n".join(f"{number}. {point}" for number, point in enumerate(points, start=1))
