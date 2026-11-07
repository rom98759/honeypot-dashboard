import asyncio

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.session_files import (
    SHA256_RE,
    SORT_KEYS,
    downloads_dir,
    file_detail,
    files_page,
    read_stored,
)
from app.zipcrypto import encrypted_zip

router = APIRouter()

ZIP_PASSWORD = b"infected"
# The largest samples seen are ~40 MB; ZipCrypto in pure Python runs at a few MB/s.
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
# One archive at a time: each one holds a CPU core for seconds.
_zip_slot = asyncio.Semaphore(1)


@router.get("/api/files")
async def list_files(
    request: Request,
    sort: str = "sessions",
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    if sort not in SORT_KEYS:
        raise HTTPException(status_code=400, detail=f"invalid sort: {sort}")
    return files_page(request.app.state.db, downloads_dir(request.app), sort, limit, offset)


@router.get("/api/files/{shasum}")
async def get_file(request: Request, shasum: str):
    detail = file_detail(request.app.state.db, downloads_dir(request.app), shasum.lower())
    if detail is None:
        raise HTTPException(status_code=404, detail="file not found")
    return detail


@router.get("/api/files/{shasum}/download")
async def download_file(request: Request, shasum: str):
    shasum = shasum.lower()
    if not SHA256_RE.fullmatch(shasum):
        raise HTTPException(status_code=404, detail="file not found")
    directory = downloads_dir(request.app)

    def build() -> bytes:
        return encrypted_zip(shasum, read_stored(directory, shasum, MAX_DOWNLOAD_BYTES), ZIP_PASSWORD)

    async with _zip_slot:
        try:
            # No database access in build(): safe off the event loop.
            archive = await asyncio.to_thread(build)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Cowrie kept no copy of this file")
        except PermissionError:
            raise HTTPException(
                status_code=503,
                detail="stored file not readable yet (host unit cowrie-downloads-perms, see docs/install.md)",
            )
        except ValueError:
            raise HTTPException(status_code=413, detail="file too large to archive")
        except OSError:  # a symlink (O_NOFOLLOW) or a vanished file
            raise HTTPException(status_code=404, detail="Cowrie kept no copy of this file")
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{shasum}.zip"',
            "Cache-Control": "no-store",
        },
    )
