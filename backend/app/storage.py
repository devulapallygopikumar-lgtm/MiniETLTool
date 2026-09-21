import uuid
from pathlib import Path

from .config import settings


def save_upload(filename: str, content: bytes) -> Path:
    dest_dir = settings.upload_dir / str(uuid.uuid4())
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / filename
    dest.write_bytes(content)
    return dest
