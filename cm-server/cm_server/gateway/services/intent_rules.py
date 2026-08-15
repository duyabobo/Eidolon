"""进模型分类前的规则层：高置信度寒暄 / 通识直接走简单问答。"""
from __future__ import annotations

import re

_MAX_DIRECT_CHARS = 120

_GREETING_RE = re.compile(
    r"^(你好|您好|嗨|哈喽|在吗|早上好|早安|中午好|下午好|晚上好|晚安|"
    r"谢谢|感谢|thank(?:s| you)?|hi|hello|hey|"
    r"ok|okay|好的|嗯+|哦+|是的|对的|明白了|知道了|收到|了解|"
    r"再见|拜拜|bye|哈哈+|"
    r"你是谁|你叫什么|你能做什么|你会什么)[\s!！。.?？,~～]*$",
    re.IGNORECASE,
)

_TOOL_CUE_RE = re.compile(
    r"(文件|目录|文件夹|附件|沙盒|workspace|wiki|"
    r"打开|读取|写入|保存|下载|上传|运行|执行|搜索|查找|"
    r"帮我查|帮我找|帮我改|帮我跑|帮我搜|"
    r"论文|文献|arxiv|pubmed|github|"
    r"脚本|报错|命令|终端|"
    r"\b(grep|bash|mcp)\b|"
    r"\.(?:py|ts|tsx|js|jsx|md|json|csv|pdf|txt|png|jpe?g|docx?|xlsx?|ya?ml|sh|sql|html)\b|"
    r"(?:^|[\s])(?:/|~/|\./|\.\./))",
    re.IGNORECASE,
)

_DEIXIS_RE = re.compile(
    r"(这[个份些段次种回]|那[个份些段次种回]|刚才|上面[的]?|如下|以下|同上|继续|"
    r"(?<![A-Za-z])(它|他|她)(?![A-Za-z]))",
)

_GENERAL_RE = re.compile(
    r"^(?:"
    r"什么是|什么叫|啥是|何为|介绍一下|解释一下|简述一下?|简单说说|"
    r"为什么|为啥|"
    r"what(?:'s| is| are)\s+|"
    r"who (?:is|was|are)\s+|"
    r"why\s+|"
    r"define\s+"
    r").+",
    re.IGNORECASE,
)

_TRANSFORM_RE = re.compile(
    r"^(?:请)?(?:帮我)?"
    r"(?:翻译成|翻译为|translate\s+|"
    r"写一首|写一段|写一句|写个笑话|讲个笑话|"
    r"润色一下|改写成).+",
    re.IGNORECASE,
)

_MATH_RE = re.compile(
    r"(算一下|计算一下|等于多少|是多少)|"
    r"^[\d\s.+\-*/()^=√]+[\d)]\s*[?？]?$",
)


def match_greeting(text: str) -> bool:
    stripped = (text or "").strip()
    return (not stripped) or bool(_GREETING_RE.fullmatch(stripped))


def match_direct_rule(text: str) -> str | None:
    """命中则返回原因，未命中返回 None（交给意图模型）。"""
    stripped = (text or "").strip()
    if match_greeting(stripped):
        return "规则：寒暄/短回复"
    if len(stripped) > _MAX_DIRECT_CHARS:
        return None
    if _TOOL_CUE_RE.search(stripped):
        return None
    if _DEIXIS_RE.search(stripped):
        return None
    if _MATH_RE.search(stripped):
        return "规则：口算/通识计算"
    if _TRANSFORM_RE.match(stripped):
        return "规则：翻译/改写/创作"
    if _GENERAL_RE.match(stripped):
        return "规则：通识问答"
    return None
