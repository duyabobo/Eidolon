"""从 GitHub 仓库导入完整 Skill 目录（SKILL.md + scripts/references/assets 等）。"""
from __future__ import annotations

import io
import logging
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status

from cm_server.admin.models.config import SkillMeta
from cm_server.admin.services import skill_meta_store
from cm_server.admin.services.skill_creator_parser import parse_skill_markdown
from cm_server.admin.services.skills_fs import _UNSAFE_NAME_RE, _user_skills_root

logger = logging.getLogger(__name__)

_GITHUB_HOSTS = {"github.com", "www.github.com"}
_MAX_ZIP_BYTES = 50 * 1024 * 1024
_HTTP_TIMEOUT_SECONDS = 120.0
_SKILL_MD_NAME = "SKILL.md"

class ParsedGithubSkillRef:
    def __init__(
        self,
        *,
        owner: str,
        repo: str,
        ref: str,
        subdir: str,
        source_url: str,
    ) -> None:
        self.owner = owner
        self.repo = repo
        self.ref = ref
        self.subdir = subdir.strip("/")
        self.source_url = source_url


def parse_github_skill_url(url: str, *, default_ref: str = "main") -> ParsedGithubSkillRef:
    raw = (url or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请填写 GitHub 仓库地址")
    if "://" not in raw:
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in _GITHUB_HOSTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 github.com 仓库地址",
        )

    parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(parts) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法解析仓库，请使用形如 https://github.com/owner/repo 的地址",
        )

    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]

    ref = default_ref
    subdir = ""
    if len(parts) >= 4 and parts[2] in {"tree", "blob"}:
        ref = parts[3]
        subdir = "/".join(parts[4:])
    elif len(parts) >= 3 and parts[2] not in {"tree", "blob", "releases", "issues", "pull"}:
        # https://github.com/owner/repo/skills/foo
        subdir = "/".join(parts[2:])

    return ParsedGithubSkillRef(
        owner=owner,
        repo=repo,
        ref=ref,
        subdir=subdir,
        source_url=raw,
    )


def _zipball_urls(ref: ParsedGithubSkillRef) -> list[str]:
    # codeload 对公开仓友好；多候选覆盖默认分支名差异
    return [
        f"https://codeload.github.com/{ref.owner}/{ref.repo}/zip/refs/heads/{ref.ref}",
        f"https://codeload.github.com/{ref.owner}/{ref.repo}/zip/refs/tags/{ref.ref}",
        f"https://codeload.github.com/{ref.owner}/{ref.repo}/zip/{ref.ref}",
        f"https://api.github.com/repos/{ref.owner}/{ref.repo}/zipball/{ref.ref}",
    ]


def _download_zip(ref: ParsedGithubSkillRef) -> bytes:
    last_error = ""
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "eidolon-skill-importer",
    }
    with httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=True, trust_env=False) as client:
        for url in _zipball_urls(ref):
            logger.info("下载 GitHub zipball: %s", url)
            resp = client.get(url, headers=headers)
            if resp.status_code >= 400:
                last_error = f"{resp.status_code} {url}"
                logger.warning("zipball 失败: %s", last_error)
                continue
            data = resp.content
            if len(data) > _MAX_ZIP_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"仓库压缩包过大（>{_MAX_ZIP_BYTES // (1024 * 1024)}MB）",
                )
            if not data.startswith(b"PK"):
                last_error = f"非 zip 响应: {url}"
                continue
            return data
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"无法下载仓库（请确认公开可访问，且分支/标签正确）: {last_error or ref.source_url}",
    )


def _extract_zip(data: bytes, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # 拒绝路径穿越
        for info in zf.infolist():
            name = info.filename
            if name.startswith("/") or ".." in Path(name).parts:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="压缩包含非法路径")
        zf.extractall(dest)
    children = [p for p in dest.iterdir() if p.is_dir()]
    if len(children) == 1:
        return children[0]
    return dest


def _find_skill_root(repo_root: Path, subdir: str) -> Path:
    if subdir:
        candidate = repo_root / subdir
        skill_md = candidate / _SKILL_MD_NAME
        if skill_md.is_file():
            return candidate
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"指定目录未找到 {_SKILL_MD_NAME}: {subdir}",
        )

    root_md = repo_root / _SKILL_MD_NAME
    if root_md.is_file():
        return repo_root

    matches = sorted(repo_root.rglob(_SKILL_MD_NAME))
    # 忽略深层噪音，优先浅层
    matches = [p for p in matches if p.is_file()]
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"仓库中未找到 {_SKILL_MD_NAME}",
        )
    matches.sort(key=lambda p: len(p.relative_to(repo_root).parts))
    return matches[0].parent


def _safe_skill_name(name: str, fallback: str) -> str:
    cleaned = (name or "").strip() or fallback
    cleaned = _UNSAFE_NAME_RE.sub("-", cleaned).strip(".-")
    if not cleaned or cleaned in {".", ".."} or "/" in cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skill 名称非法")
    return cleaned


def _copy_skill_tree(src: Path, dest: Path) -> list[str]:
    """复制整个 skill 目录（含 scripts/references/assets 及同级其它文件）。"""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for item in src.iterdir():
        if item.name in {".git", ".github", "__MACOSX"}:
            continue
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
            copied.append(f"{item.name}/")
        else:
            shutil.copy2(item, target)
            copied.append(item.name)
    # 确保 SKILL.md 存在
    if not (dest / _SKILL_MD_NAME).is_file():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="复制后缺少 SKILL.md")
    return copied


async def import_skill_from_github(
    *,
    user_id: str,
    github_url: str,
    ref: str | None = None,
    subdir: str | None = None,
    overwrite: bool = False,
) -> dict:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先设置用户 ID")

    parsed = parse_github_skill_url(github_url)
    if ref and ref.strip():
        parsed.ref = ref.strip()
    if subdir is not None:
        parsed.subdir = subdir.strip().strip("/")

    zip_bytes = _download_zip(parsed)
    with tempfile.TemporaryDirectory(prefix="skill-gh-") as tmp:
        tmp_path = Path(tmp)
        extract_root = tmp_path / "extract"
        repo_root = _extract_zip(zip_bytes, extract_root)
        skill_src = _find_skill_root(repo_root, parsed.subdir)

        raw_md = (skill_src / _SKILL_MD_NAME).read_text(encoding="utf-8")
        parsed_md = parse_skill_markdown(raw_md) or {}
        skill_name = _safe_skill_name(
            str(parsed_md.get("name") or ""),
            fallback=skill_src.name,
        )
        description = str(parsed_md.get("description") or "").strip()
        tags = parsed_md.get("tags") if isinstance(parsed_md.get("tags"), list) else []
        mcp_tools = parsed_md.get("mcp_tools") if isinstance(parsed_md.get("mcp_tools"), list) else []
        tags = [str(t).strip() for t in tags if str(t).strip()]
        mcp_tools = [str(t).strip() for t in mcp_tools if str(t).strip()]

        dest = _user_skills_root(uid) / skill_name
        if dest.exists() and not overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Skill「{skill_name}」已存在，如需覆盖请勾选覆盖导入",
            )

        copied = _copy_skill_tree(skill_src, dest)
        logger.info(
            "GitHub Skill 已导入 user=%s name=%s src=%s files=%s",
            uid,
            skill_name,
            parsed.source_url,
            copied,
        )

    meta = SkillMeta(
        name=skill_name,
        description=description or f"Imported from {parsed.owner}/{parsed.repo}",
        user_id=uid,
        tags=tags,
        mcp_tools=mcp_tools,
        hidden=False,
        source="github",
    )
    await skill_meta_store.save_skill_meta(meta)
    return {
        "name": skill_name,
        "description": meta.description,
        "scope": "user",
        "copied_entries": copied,
        "source": {
            "owner": parsed.owner,
            "repo": parsed.repo,
            "ref": parsed.ref,
            "subdir": parsed.subdir,
            "url": parsed.source_url,
        },
    }
