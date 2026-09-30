import os
from pathlib import Path


LOCAL_LLM_DIR = Path(os.getenv("LOCAL_LLM_DIR", "D:/YT-Chatbot-local-ai"))
EMBEDDING_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_MODEL = str(LOCAL_LLM_DIR / "embeddings" / "all-MiniLM-L6-v2")
LLAMA_SERVER_EXE = Path(
    os.getenv("LLAMA_SERVER_EXE", str(LOCAL_LLM_DIR / "runtime" / "llama-server.exe"))
)
LLM_MODEL_PATH = Path(
    os.getenv(
        "LLM_MODEL_PATH",
        str(LOCAL_LLM_DIR / "models" / "qwen2.5-0.5b-instruct-q4_k_m.gguf"),
    )
)
LLAMA_HOST = os.getenv("LLAMA_HOST", "127.0.0.1")
LLAMA_PORT = int(os.getenv("LLAMA_PORT", "8080"))
LLAMA_URL = f"http://{LLAMA_HOST}:{LLAMA_PORT}"
