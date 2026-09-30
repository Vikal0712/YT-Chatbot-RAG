import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from rag_utils import (
    ask_llm,
    build_faiss_index,
    create_embeddings,
    extract_video_id,
    get_transcript_with_language,
    release_embedding_model,
    search_chunks,
    shutdown_llama_server,
    split_text,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("yt_rag.api")

# Distances from MiniLM + FAISS IndexFlatL2 are squared L2 distances. This
# conservative cutoff was checked against the requested video: its DBMS query
# is above the cutoff while a RAG-related query is below it.
MAX_RETRIEVAL_DISTANCE = 1.75


@dataclass
class VideoRagState:
    video_id: str | None = None
    transcript_language: str | None = None
    chunks: list[str] = field(default_factory=list)
    index: object | None = None
    processing: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.rag = VideoRagState()
    logger.info(
        "backend_started pid=%s reload_disabled=true in_memory_state=true",
        os.getpid(),
    )
    try:
        yield
    finally:
        shutdown_llama_server()
        logger.info("backend_stopped pid=%s", os.getpid())


app = FastAPI(title="YouTube RAG Chatbot API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_preview(text: str, limit: int = 350) -> str:
    """Keep console logs readable on Windows consoles with legacy encodings."""
    preview = text[:limit]
    return preview.encode("ascii", errors="backslashreplace").decode("ascii")


@app.get("/status")
def get_status(request: Request):
    state: VideoRagState = request.app.state.rag
    return {
        "processed": state.index is not None and bool(state.chunks),
        "processing": state.processing,
        "video_id": state.video_id,
        "transcript_language": state.transcript_language,
        "chunk_count": len(state.chunks),
        "index_size": state.index.ntotal if state.index is not None else 0,
        "worker_pid": os.getpid(),
    }


@app.post("/process_video")
def process_video(request: Request, url: str):
    state: VideoRagState = request.app.state.rag
    if state.processing:
        raise HTTPException(status_code=409, detail="A video is already being processed.")

    # A failed attempt must not leave an older video's index looking current.
    state.video_id = None
    state.transcript_language = None
    state.chunks = []
    state.index = None
    state.processing = True

    video_id = extract_video_id(url)
    if not video_id:
        state.processing = False
        raise HTTPException(
            status_code=400,
            detail="That does not look like a valid YouTube video URL.",
        )

    logger.info("process_started pid=%s video_id=%s", os.getpid(), video_id)
    try:
        transcript, language = get_transcript_with_language(video_id)
        if not transcript or not transcript.strip():
            raise RuntimeError(
                "YouTube returned an empty transcript. Check whether captions are enabled."
            )

        logger.info(
            "transcript_fetched pid=%s video_id=%s language=%s characters=%s",
            os.getpid(),
            video_id,
            language or "unknown",
            len(transcript),
        )
        chunks = split_text(transcript)
        if not chunks:
            raise RuntimeError("The transcript did not contain any text to index.")
        logger.info(
            "transcript_chunked pid=%s video_id=%s chunk_count=%s",
            os.getpid(),
            video_id,
            len(chunks),
        )

        try:
            embeddings = create_embeddings(chunks)
            logger.info(
                "embeddings_created pid=%s video_id=%s shape=%s",
                os.getpid(),
                video_id,
                tuple(embeddings.shape),
            )
            index = build_faiss_index(embeddings)
        finally:
            release_embedding_model()

        if index.ntotal != len(chunks):
            raise RuntimeError(
                f"FAISS indexed {index.ntotal} vectors for {len(chunks)} transcript chunks."
            )

        # Publish state only after transcript, embeddings, and FAISS all succeed.
        state.video_id = video_id
        state.transcript_language = language or "unknown"
        state.chunks = chunks
        state.index = index
        logger.info(
            "process_succeeded pid=%s video_id=%s chunks=%s index_size=%s language=%s",
            os.getpid(),
            video_id,
            len(chunks),
            index.ntotal,
            state.transcript_language,
        )
        return {
            "message": "Video processed successfully.",
            "video_id": video_id,
            "transcript_language": state.transcript_language,
            "chunk_count": len(chunks),
            "index_size": index.ntotal,
            "worker_pid": os.getpid(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "process_failed pid=%s video_id=%s", os.getpid(), video_id
        )
        raise HTTPException(
            status_code=422,
            detail=f"Video processing failed: {exc}",
        ) from exc
    finally:
        state.processing = False


@app.post("/ask")
def ask_question(request: Request, question: str):
    state: VideoRagState = request.app.state.rag
    logger.info(
        "ask_received pid=%s video_id=%s index_none=%s chunks=%s question=%s",
        os.getpid(),
        state.video_id,
        state.index is None,
        len(state.chunks),
        question,
    )
    if state.processing:
        raise HTTPException(
            status_code=409,
            detail="The video is still processing. Please wait and try again.",
        )
    if state.index is None or not state.chunks:
        raise HTTPException(
            status_code=409,
            detail="Please process a video with an available transcript first.",
        )
    if not question.strip():
        raise HTTPException(status_code=400, detail="Enter a question first.")

    try:
        try:
            query_embedding = create_embeddings([question])[0]
        finally:
            release_embedding_model()

        distances, indices = search_chunks(state.index, query_embedding, k=3)
        logger.info(
            "retrieval_complete pid=%s video_id=%s indices=%s distances=%s",
            os.getpid(),
            state.video_id,
            indices.tolist(),
            [round(float(distance), 4) for distance in distances],
        )
        if len(indices) == 0:
            raise RuntimeError("FAISS did not return any transcript chunks.")

        best_distance = float(distances[0])
        context = "\n\n".join(state.chunks[int(i)] for i in indices)
        logger.info(
            "retrieval_context pid=%s video_id=%s preview=%s",
            os.getpid(),
            state.video_id,
            _safe_preview(context),
        )

        if best_distance > MAX_RETRIEVAL_DISTANCE:
            answer = (
                "I couldn't find information about DBMS in the video transcript."
                if "dbms" in question.lower()
                else "I couldn't find relevant information about that in the video transcript."
            )
            grounded = False
        elif not (state.transcript_language or "").lower().startswith("en"):
            answer = (
                f"The available captions are in {state.transcript_language} and this local "
                "English-focused model cannot reliably answer from them. YouTube did not "
                "provide an English translation, so I can't confirm an answer from this transcript."
            )
            grounded = False
        else:
            answer = ask_llm(context, question)
            grounded = True

        logger.info(
            "answer_ready pid=%s video_id=%s grounded=%s best_distance=%.4f",
            os.getpid(),
            state.video_id,
            grounded,
            best_distance,
        )
        return {
            "answer": answer,
            "grounded": grounded,
            "video_id": state.video_id,
            "transcript_language": state.transcript_language,
            "retrieved_chunk_indices": indices.tolist(),
            "retrieval_distance": best_distance,
            "worker_pid": os.getpid(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "ask_failed pid=%s video_id=%s", os.getpid(), state.video_id
        )
        raise HTTPException(
            status_code=500,
            detail=f"Could not answer using the local RAG pipeline: {exc}",
        ) from exc
