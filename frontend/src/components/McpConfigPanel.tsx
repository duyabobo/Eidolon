import { useState } from "react";
import { configApi, McpServerConfig } from "../api/config";
import type { McpServerItem } from "../api/mcp";
import { ScopeBadge } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import {
  MarketComingSoon,
  MineMarketToolbar,
  type MineMarketTab,
} from "./config/MineMarketTabs";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
import { McpEditModal, McpServerRow } from "./McpServerUi";
import { serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";

const EMPTY_SERVER: McpServerConfig = { url: "", description: "", enabled: true, api_key: "" };

type EditState = {
  scope: "system" | "user";
  name: string;
  config: McpServerConfig;
  isNew: boolean;
};

export default function McpConfigPanel() {
  const [tab, setTab] = useState<MineMarketTab>("mine");
  const {
    servers,
    loading,
    probingKeys,
    statusMap,
    errMsg,
    setErrMsg,
    probeOne,
    saveServer,
    toggleEnabled,
    deleteServer,
  } = useMcpManager({ includeDisabled: true });

  const [edit, setEdit] = useState<EditState | null>(null);

  const handleDelete = async (server: McpServerItem) => {
    const label = server.scope === "system" ? "系统" : "个人";
    if (!confirm(`确认删除${label} MCP "${server.name}"？`)) return;
    try {
      await deleteServer(server);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const openSystemEdit = async (server: McpServerItem) => {
    try {
      const full = await configApi.getMcp();
      const cfg = full.servers[server.name] ?? {
        url: server.url,
        description: server.description,
        enabled: server.enabled,
        api_key: "",
      };
      setEdit({
        scope: "system",
        name: server.name,
        isNew: false,
        config: { ...cfg, api_key: cfg.api_key ?? "" },
      });
    } catch {
      setEdit({
        scope: "system",
        name: server.name,
        isNew: false,
        config: {
          url: server.url,
          description: server.description,
          enabled: server.enabled,
          api_key: "",
        },
      });
    }
  };

  const openUserEdit = (server: McpServerItem) => {
    setEdit({
      scope: "user",
      name: server.name,
      isNew: false,
      config: {
        url: server.url,
        description: server.description ?? "",
        enabled: server.enabled !== false,
        api_key: "",
      },
    });
  };

  const openUserCreate = () => {
    setEdit({
      scope: "user",
      name: "",
      isNew: true,
      config: { ...EMPTY_SERVER },
    });
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    if (!edit.name.trim()) {
      setErrMsg("名称不能为空");
      return;
    }
    if (!edit.config.url?.trim()) {
      setErrMsg("URL 不能为空");
      return;
    }
    try {
      await saveServer(edit.scope, edit.name.trim(), edit.config);
      setEdit(null);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleToggleEnabled = async (server: McpServerItem, enabled: boolean) => {
    try {
      await toggleEnabled(server, enabled);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "更新失败");
    }
  };

  const pagination = useClientPagination(servers, CONFIG_PAGE_SIZE);

  return (
    <ConfigPanelLayout
      loading={tab === "mine" && loading}
      errMsg={errMsg}
      toolbar={(
        <MineMarketToolbar
          tab={tab}
          onTabChange={setTab}
          onAdd={openUserCreate}
        />
      )}
      pagination={tab === "mine" ? (
        <ConfigListPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
        />
      ) : undefined}
    >
      {tab === "market" ? (
        <MarketComingSoon subtitle="工具服务市场正在规划中，敬请期待" />
      ) : servers.length === 0 ? (
        <ConfigEmptyState message="暂无 MCP Server" />
      ) : (
        <div className="space-y-2">
          {pagination.slice.map((server) => {
            const key = serverStatusKey(server);
            return (
              <McpServerRow
                key={key}
                server={server}
                status={statusMap[key]}
                probing={probingKeys.has(key)}
                scopeBadge={<ScopeBadge scope={server.scope} />}
                onToggleEnabled={(enabled) => void handleToggleEnabled(server, enabled)}
                onProbe={() => void probeOne(server)}
                onEdit={() => (server.scope === "system" ? void openSystemEdit(server) : openUserEdit(server))}
                onDelete={() => void handleDelete(server)}
              />
            );
          })}
        </div>
      )}

      {edit && (
        <McpEditModal
          title={
            edit.isNew
              ? "添加个人 MCP"
              : edit.scope === "system"
                ? `编辑系统 MCP · ${edit.name}`
                : `编辑个人 MCP · ${edit.name}`
          }
          name={edit.name}
          nameReadonly={!edit.isNew}
          onNameChange={(name) => setEdit({ ...edit, name })}
          config={edit.config}
          onChange={(patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } })}
          onSave={() => void handleSaveEdit()}
          onCancel={() => setEdit(null)}
        />
      )}
    </ConfigPanelLayout>
  );
}
