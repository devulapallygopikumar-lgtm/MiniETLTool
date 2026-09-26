from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import require_permission
from ..readers.base import detect_format
from ..runner import discover_and_create_datasets
from ..storage import save_upload
from .datasets import to_out

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])


@router.post("", response_model=schemas.UploadResult)
async def upload_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(require_permission("batch:upload")),
    db: Session = Depends(get_db),
):
    filename = file.filename or "upload"
    format = detect_format(filename)
    if format is None:
        raise HTTPException(400, "Unsupported file type. Use CSV, Excel (.xlsx/.xls) or XML.")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty.")

    path = save_upload(filename, content)

    try:
        datasets = discover_and_create_datasets(db, path, filename, format, current_user.id)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user as a readable upload error
        raise HTTPException(422, f"Could not read this file: {exc}") from exc

    for d in datasets:
        audit.log(db, "dataset.uploaded", "dataset", d.id, reason=f"filename={filename}")
    db.commit()

    return schemas.UploadResult(datasets=[to_out(d) for d in datasets])
