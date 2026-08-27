"""End-to-end smoke test for the portal API.

Runs against SQLite plus local-folder storage, so it needs no external services.

    .venv/Scripts/python.exe tests/smoke_test.py      (Windows)
    .venv/bin/python tests/smoke_test.py              (macOS / Linux)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix="sftp-smoke-"))

os.environ["DATABASE_URL"] = "sqlite:///" + (WORK / "test.db").as_posix()
os.environ["STORAGE_BACKEND"] = "local"
os.environ["LOCAL_STORAGE_DIR"] = str(WORK / "storage")
os.environ["JWT_SECRET"] = "smoke-test-secret"
os.environ["BOOTSTRAP_TOKEN"] = ""

sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

client = TestClient(app)
PASSED: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    if condition:
        PASSED.append(label)
        print("  PASS  " + label)
    else:
        print("  FAIL  " + label + "  ->  " + repr(detail))
        raise SystemExit(1)


def bearer(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def main() -> None:
    print("\n[1] health and bootstrap status")
    health = client.get("/api/health").json()
    check("health reports ok", health["status"] == "ok", health)
    check("storage backend is local", health["storage_backend"] == "local", health)
    status = client.get("/api/bootstrap/status").json()
    check("portal needs bootstrap", status["needs_bootstrap"] is True, status)

    print("\n[2] bootstrap creates the first admin")
    r = client.post(
        "/api/bootstrap",
        json={"username": "Root.Admin", "password": "AdminPass123", "email": "a@example.com"},
    )
    check("bootstrap returns 201", r.status_code == 201, r.text)
    admin = bearer(r.json()["access_token"])
    check("admin role assigned", r.json()["user"]["role"] == "admin", r.json())
    check("username normalised to lowercase", r.json()["user"]["username"] == "root.admin", r.json())

    r = client.post("/api/bootstrap", json={"username": "second", "password": "AdminPass123"})
    check("second bootstrap rejected with 409", r.status_code == 409, r.text)
    check(
        "status now says bootstrap is closed",
        client.get("/api/bootstrap/status").json()["needs_bootstrap"] is False,
    )

    print("\n[3] login rules")
    r = client.post(
        "/api/auth/login",
        json={"username": "root.admin", "password": "AdminPass123", "role": "admin"},
    )
    check("admin logs in on the admin portal", r.status_code == 200, r.text)
    r = client.post(
        "/api/auth/login",
        json={"username": "root.admin", "password": "AdminPass123", "role": "user"},
    )
    check("admin blocked from the user portal", r.status_code == 403, r.text)
    r = client.post(
        "/api/auth/login", json={"username": "root.admin", "password": "nope", "role": "admin"}
    )
    check("wrong password rejected", r.status_code == 401, r.text)

    print("\n[4] admin creates users")
    r = client.post("/api/admin/users", headers=admin, json={"username": "alice"})
    check("user created with a generated password", r.status_code == 201, r.text)
    alice = r.json()["user"]
    alice_password = r.json()["password"]
    check("generated flag set", r.json()["generated"] is True, r.json())
    check("must_change_password set", alice["must_change_password"] is True, alice)

    r = client.post(
        "/api/admin/users",
        headers=admin,
        json={"username": "bob", "password": "BobPass12345", "full_name": "Bob B"},
    )
    check("user created with an explicit password", r.status_code == 201, r.text)
    bob = r.json()["user"]

    r = client.post("/api/admin/users", headers=admin, json={"username": "alice"})
    check("duplicate username rejected", r.status_code == 409, r.text)

    print("\n[5] authorisation boundaries")
    r = client.post(
        "/api/auth/login", json={"username": "alice", "password": alice_password, "role": "user"}
    )
    check("alice logs in", r.status_code == 200, r.text)
    alice_h = bearer(r.json()["access_token"])
    check(
        "alice blocked from the admin user list",
        client.get("/api/admin/users", headers=alice_h).status_code == 403,
    )
    check(
        "alice blocked from uploading",
        client.post(
            "/api/admin/files",
            headers=alice_h,
            files=[("files", ("x.txt", b"x", "text/plain"))],
        ).status_code
        == 403,
    )
    check("anonymous request rejected", client.get("/api/files").status_code == 401)

    print("\n[6] uploads: single, multiple, targeted")
    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[("files", ("manifest.txt", b"one file contents", "text/plain"))],
        data={"notes": "shared with everyone"},
    )
    check("single upload succeeds", r.status_code == 201, r.text)
    shared_file = r.json()["uploaded"][0]
    check("shared with everyone by default", shared_file["shared_with_everyone"] is True, shared_file)
    check("note stored", shared_file["notes"] == "shared with everyone", shared_file)

    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[
            ("files", ("a.csv", b"col1,col2\n1,2\n", "text/csv")),
            ("files", ("b.csv", b"col1,col2\n3,4\n", "text/csv")),
            ("files", ("c.bin", b"\x00\x01\x02binary", "application/octet-stream")),
        ],
    )
    check("multi upload accepts 3 files at once", len(r.json()["uploaded"]) == 3, r.text)

    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[("files", ("bob-only.txt", b"just for bob", "text/plain"))],
        data={"assigned_user_ids": json.dumps([bob["id"]])},
    )
    check("targeted upload succeeds", r.status_code == 201, r.text)
    bob_file = r.json()["uploaded"][0]
    check("targeted file is not shared with all", bob_file["shared_with_everyone"] is False, bob_file)

    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[("files", ("x.txt", b"x", "text/plain"))],
        data={"assigned_user_ids": json.dumps(["does-not-exist"])},
    )
    check("unknown assignee rejected", r.status_code == 400, r.text)

    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[("files", ("empty.txt", b"", "text/plain"))],
    )
    check("empty file rejected", r.status_code == 400, r.text)

    print("\n[7] visibility rules")
    names = sorted(f["original_name"] for f in client.get("/api/files", headers=alice_h).json())
    check("alice sees the 4 shared files", names == ["a.csv", "b.csv", "c.bin", "manifest.txt"], names)

    r = client.post(
        "/api/auth/login", json={"username": "bob", "password": "BobPass12345", "role": "user"}
    )
    bob_h = bearer(r.json()["access_token"])
    bob_names = sorted(f["original_name"] for f in client.get("/api/files", headers=bob_h).json())
    check(
        "bob sees shared files plus his own",
        bob_names == ["a.csv", "b.csv", "bob-only.txt", "c.bin", "manifest.txt"],
        bob_names,
    )

    admin_files = client.get("/api/admin/files", headers=admin).json()
    check("admin sees all 5 files", len(admin_files) == 5, len(admin_files))
    check(
        "uploader recorded",
        all(f["uploaded_by"] == "root.admin" for f in admin_files),
        admin_files,
    )

    print("\n[8] download flow")
    r = client.post("/api/files/" + shared_file["id"] + "/download-link", headers=alice_h)
    check("download link issued", r.status_code == 200, r.text)
    url = r.json()["url"]
    r = client.get(url)
    check("download returns the original bytes", r.content == b"one file contents", r.content[:40])
    check(
        "download without a token is rejected",
        client.get("/api/files/" + shared_file["id"] + "/download").status_code == 401,
    )
    r = client.post("/api/files/" + bob_file["id"] + "/download-link", headers=alice_h)
    check("alice cannot get a link for bob's file", r.status_code == 403, r.text)

    # A token minted for one file must not open a different one.
    stolen = url.split("t=")[1]
    other_id = next(f["id"] for f in admin_files if f["id"] != shared_file["id"])
    r = client.get("/api/files/" + other_id + "/download?t=" + stolen)
    check("download token is bound to its file", r.status_code == 403, r.status_code)

    print("\n[9] password reset and self-service change")
    r = client.post("/api/admin/users/" + alice["id"] + "/reset-password", headers=admin, json={})
    check("reset issues a new password", r.status_code == 200, r.text)
    new_password = r.json()["password"]
    check("new password differs from the old one", new_password != alice_password)
    check(
        "old password no longer works",
        client.post(
            "/api/auth/login",
            json={"username": "alice", "password": alice_password, "role": "user"},
        ).status_code
        == 401,
    )
    r = client.post(
        "/api/auth/login", json={"username": "alice", "password": new_password, "role": "user"}
    )
    check("new password works", r.status_code == 200, r.text)
    alice_h = bearer(r.json()["access_token"])

    r = client.post(
        "/api/admin/users/" + alice["id"] + "/reset-password",
        headers=admin,
        json={"password": "short"},
    )
    check("a too-short reset password is rejected", r.status_code == 422, r.status_code)

    r = client.post(
        "/api/auth/change-password",
        headers=alice_h,
        json={"current_password": new_password, "new_password": "AliceOwnPass1"},
    )
    check("alice changes her own password", r.status_code == 200, r.text)
    check(
        "must_change_password cleared",
        client.get("/api/auth/me", headers=alice_h).json()["must_change_password"] is False,
    )
    r = client.post(
        "/api/auth/change-password",
        headers=alice_h,
        json={"current_password": "wrong", "new_password": "Another12345"},
    )
    check("change with a wrong current password is rejected", r.status_code == 400, r.text)

    print("\n[10] admin accounts are protected")
    admin_id = client.get("/api/auth/me", headers=admin).json()["id"]
    check(
        "admin cannot be reset through user management",
        client.post(
            "/api/admin/users/" + admin_id + "/reset-password", headers=admin, json={}
        ).status_code
        == 400,
    )
    check(
        "admin cannot be deleted through user management",
        client.delete("/api/admin/users/" + admin_id, headers=admin).status_code == 400,
    )

    print("\n[11] disable, delete, cleanup")
    r = client.patch("/api/admin/users/" + bob["id"], headers=admin, json={"is_active": False})
    check("bob disabled", r.json()["is_active"] is False, r.json())
    check(
        "a disabled user cannot log in",
        client.post(
            "/api/auth/login",
            json={"username": "bob", "password": "BobPass12345", "role": "user"},
        ).status_code
        == 403,
    )
    check(
        "an existing token for a disabled user stops working",
        client.get("/api/files", headers=bob_h).status_code == 401,
    )

    uploads_dir = Path(os.environ["LOCAL_STORAGE_DIR"]) / "uploads"
    before = len(list(uploads_dir.iterdir()))
    r = client.delete("/api/admin/files/" + bob_file["id"], headers=admin)
    check("file deleted", r.status_code == 200, r.text)
    check("the stored object is removed from disk", len(list(uploads_dir.iterdir())) == before - 1)
    check("file list shrinks to 4", len(client.get("/api/admin/files", headers=admin).json()) == 4)

    r = client.delete("/api/admin/users/" + bob["id"], headers=admin)
    check("user deleted", r.status_code == 200, r.text)
    remaining = [u["username"] for u in client.get("/api/admin/users", headers=admin).json()]
    check("bob is gone, alice and the admin remain", sorted(remaining) == ["alice", "root.admin"], remaining)

    print("\n[12] PDFs disappear from a dashboard once collected")
    r = client.post(
        "/api/admin/files",
        headers=admin,
        files=[
            ("files", ("report.pdf", b"%PDF-1.4 fake pdf", "application/pdf")),
            ("files", ("keep.csv", b"a,b\n1,2\n", "text/csv")),
        ],
    )
    check("pdf and csv uploaded", r.status_code == 201, r.text)
    pdf = next(f for f in r.json()["uploaded"] if f["original_name"] == "report.pdf")
    csv = next(f for f in r.json()["uploaded"] if f["original_name"] == "keep.csv")
    check("pdf flagged as pdf", pdf["is_pdf"] is True, pdf)
    check("csv not flagged as pdf", csv["is_pdf"] is False, csv)
    check("retention window reported", pdf["seconds_remaining"] > 0, pdf)

    def alice_sees() -> list:
        return sorted(f["original_name"] for f in client.get("/api/files", headers=alice_h).json())

    check("alice sees the pdf before downloading", "report.pdf" in alice_sees(), alice_sees())

    link = client.post("/api/files/" + pdf["id"] + "/download-link", headers=alice_h).json()["url"]
    r = client.get(link)
    check("alice downloads the pdf", r.content == b"%PDF-1.4 fake pdf", r.content[:20])
    check("the pdf leaves alice's dashboard", "report.pdf" not in alice_sees(), alice_sees())

    # The same PDF must still be waiting for every other recipient.
    r = client.post("/api/admin/users", headers=admin, json={"username": "carol"})
    carol_password = r.json()["password"]
    r = client.post(
        "/api/auth/login", json={"username": "carol", "password": carol_password, "role": "user"}
    )
    carol_h = bearer(r.json()["access_token"])

    def carol_sees() -> list:
        return sorted(f["original_name"] for f in client.get("/api/files", headers=carol_h).json())

    check("carol still sees the pdf alice collected", "report.pdf" in carol_sees(), carol_sees())

    # Non-PDFs stay put after being downloaded.
    link = client.post("/api/files/" + csv["id"] + "/download-link", headers=alice_h).json()["url"]
    client.get(link)
    check("a downloaded csv stays on the dashboard", "keep.csv" in alice_sees(), alice_sees())

    def admin_row(name: str) -> dict:
        rows = client.get("/api/admin/files", headers=admin).json()
        return next(f for f in rows if f["original_name"] == name)

    check("admin still sees the collected pdf", admin_row("report.pdf")["id"] == pdf["id"])
    check("admin sees the download count", admin_row("report.pdf")["download_count"] == 1)

    # An admin opening a file must not count as a recipient collecting it.
    link = client.post("/api/files/" + pdf["id"] + "/download-link", headers=admin).json()["url"]
    client.get(link)
    check("an admin download is not a collection", admin_row("report.pdf")["download_count"] == 1)
    check("the pdf survives on carol's dashboard", "report.pdf" in carol_sees(), carol_sees())

    print("\n[13] retention: files are deleted RETENTION_DAYS after upload")
    import datetime as _dt

    from backend.config import settings as _settings
    from backend.db import SessionLocal
    from backend.models import StoredFile as _StoredFile

    check("retention window defaults to 5 days", _settings.retention_days == 5, _settings.retention_days)

    # Backdate one file past the window and one to just inside it.
    session = SessionLocal()
    stale = session.get(_StoredFile, csv["id"])
    stale.created_at = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=6)
    stale_key = stale.storage_key
    fresh = session.get(_StoredFile, pdf["id"])
    fresh.created_at = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=4, hours=23)
    session.commit()
    session.close()

    stale_path = Path(os.environ["LOCAL_STORAGE_DIR"]) / stale_key
    check("the stale file is still on disk before the sweep", stale_path.exists())

    check(
        "cleanup rejects an unauthenticated call",
        client.get("/api/maintenance/cleanup").status_code == 401,
    )
    check(
        "cleanup rejects a non-admin",
        client.get("/api/maintenance/cleanup", headers=alice_h).status_code == 403,
    )

    r = client.get("/api/maintenance/cleanup", headers=admin)
    check("cleanup runs for an admin", r.status_code == 200, r.text)
    check("exactly the 6-day-old file was deleted", r.json()["files"] == ["keep.csv"], r.json())
    check("cleanup reports the retention window", r.json()["retention_days"] == 5, r.json())
    check("its bytes are gone from disk", not stale_path.exists())

    remaining = [f["original_name"] for f in client.get("/api/admin/files", headers=admin).json()]
    check("the expired file left the portal", "keep.csv" not in remaining, remaining)
    check("the 4-day-old file survived", "report.pdf" in remaining, remaining)
    check(
        "a deleted file cannot be downloaded",
        client.post("/api/files/" + csv["id"] + "/download-link", headers=alice_h).status_code == 404,
    )

    # Listing alone must also enforce retention, for portals that never get a cron hit.
    session = SessionLocal()
    doomed = session.get(_StoredFile, pdf["id"])
    doomed.created_at = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=5, minutes=1)
    doomed_path = Path(os.environ["LOCAL_STORAGE_DIR"]) / doomed.storage_key
    session.commit()
    session.close()

    client.get("/api/files", headers=carol_h)
    check("listing files purges what has expired", not doomed_path.exists())
    check(
        "and it is gone from the admin list",
        "report.pdf" not in [f["original_name"] for f in client.get("/api/admin/files", headers=admin).json()],
    )

    print("\n" + str(len(PASSED)) + " checks passed.\n")


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
