"""知识库本地文件布局：{sandbox}/global/knowledge/{kb_id}/{doc_id}/..."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from cm_server.admin.config import settings
from cm_server.admin.constants.knowledge import PHASE1_MD_NAME, PHASE2_TREE_NAME

logger = logging.getLogger(__name__)


def knowledge_root() -> Path:
    root = Path(settings.sandbox_root) / "global" / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def doc_dir(kb_id: str, doc_id: str) -> Path:
    return knowledge_root() / kb_id / doc_id


def preprocess_dir(kb_id: str, doc_id: str) -> Path:
    return doc_dir(kb_id, doc_id) / "preprocess"


def result_dir(kb_id: str, doc_id: str) -> Path:
    return preprocess_dir(kb_id, doc_id) / "result"


def wiki_dir(kb_id: str, doc_id: str) -> Path:
    return result_dir(kb_id, doc_id) / "wiki"


def log_dir(kb_id: str, doc_id: str) -> Path:
    return preprocess_dir(kb_id, doc_id) / "log"


def phase1_path(kb_id: str, doc_id: str) -> Path:
    return result_dir(kb_id, doc_id) / PHASE1_MD_NAME


def phase2_path(kb_id: str, doc_id: str) -> Path:
    return result_dir(kb_id, doc_id) / PHASE2_TREE_NAME


def ensure_preprocess_layout(kb_id: str, doc_id: str) -> None:
    result_dir(kb_id, doc_id).mkdir(parents=True, exist_ok=True)
    wiki_dir(kb_id, doc_id).mkdir(parents=True, exist_ok=True)
    log_dir(kb_id, doc_id).mkdir(parents=True, exist_ok=True)


def delete_doc_files(kb_id: str, doc_id: str) -> None:
    path = doc_dir(kb_id, doc_id)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
        logger.info("已删除文档目录: %s", path)


def delete_kb_files(kb_id: str) -> None:
    path = knowledge_root() / kb_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
        logger.info("已删除知识库目录: %s", path)


def resolve_original_file(kb_id: str, doc_id: str, filename: str) -> Path:
    return doc_dir(kb_id, doc_id) / filename
