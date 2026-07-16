import { jsx as _jsx } from "react/jsx-runtime";
import LlmConfigPanel from "../components/LlmConfigPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
export default function LlmPage() {
    return (_jsx(ManagePageLayout, { title: "\u6A21\u578B", children: _jsx(LlmConfigPanel, {}) }));
}
