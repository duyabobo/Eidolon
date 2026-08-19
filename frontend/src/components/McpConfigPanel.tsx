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
import PluginCreatorChat from "./PluginCreatorChat";
import { isLocalPlugin, serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";

const EMPTY_REMOTE: McpServerConfig = {
  url: "",
  description: "",
  enabled: true,
  api_key: "",
  transport: "http",
};

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
    load,
    probeOne,
    saveServer,
    toggleEnabled,
    deleteServer,
  } = useMcpManager({ includeDisabled: true });

  const [showCreator, setShowCreator] = useState(false);
  const [editPluginName, setEditPluginName] = useState<string | undefined>(undefined);
  const [edit, setEdit] = useState<EditState | null>(null);

  const handleDelete = async (server: McpServerItem) => {
    const label = server.scope === "system" ? "系统" : "个人";
    if (!confirm(`确认删除${label}插件 "${server.name}"？`)) return;
    try {
      await deleteServer(server);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const openCreator = (pluginName?: string) => {
    setEditPluginName(pluginName);
    setShowCreator(true);
  };

  const openHttpEdit = async (server: McpServerItem) => {
    const fallback: McpServerConfig = {
      url: server.url,
      description: server.description ?? "",
      enabled: server.enabled !== false,
      api_key: "",
      transport: "http",
    };
    if (server.scope !== "system") {
      setEdit({ scope: "user", name: server.name, config: fallback, isNew: false });
      return;
    }
    try {
      const full = await configApi.getMcp();
      const cfg = full.servers[server.name] ?? fallback;
      setEdit({
        scope: "system",
        name: server.name,
        config: { ...cfg, api_key: cfg.api_key ?? "" },
        isNew: false,
      });
    } catch {
      setEdit({ scope: "system", name: server.name, config: fallback, isNew: false });
    }
  };

  const handleEdit = (server: McpServerItem) => {
    if (isLocalPlugin(server) && server.scope === "user") {
      openCreator(server.name);
      return;
    }
    void openHttpEdit(server);
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
      await saveServer(edit.scope, edit.name.trim(), { ...edit.config, transport: "http" });
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
          addDisabled={showCreator}
          addItems={[
            {
              id: "chat",
              label: "对话写代码",
              hint: "Agent 在本机实现并安装",
              onClick: () => openCreator(),
            },
            {
              id: "remote",
              label: "添加远程 MCP",
              hint: "填写已有 MCP Server 地址",
              onClick: () => setEdit({
                scope: "user",
                name: "",
                config: { ...EMPTY_REMOTE },
                isNew: true,
              }),
            },
          ]}
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
        <MarketComingSoon subtitle="插件市场正在规划中，敬请期待" />
      ) : servers.length === 0 ? (
        <ConfigEmptyState message="暂无插件。可对话写代码安装到本机，或添加远程 MCP Server。" />
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
                onEdit={
                  isLocalPlugin(server) && server.scope !== "user"
                    ? undefined
                    : () => handleEdit(server)
                }
                onDelete={() => void handleDelete(server)}
              />
            );
          })}
        </div>
      )}

      {showCreator && (
        <PluginCreatorChat
          editPluginName={editPluginName}
          onClose={() => {
            setShowCreator(false);
            setEditPluginName(undefined);
          }}
          onPublished={() => {
            setShowCreator(false);
            setEditPluginName(undefined);
            void load({ silent: true });
          }}
        />
      )}

      {edit && (
        <McpEditModal
          title={
            edit.isNew
              ? "添加远程 MCP"
              : edit.scope === "system"
                ? `编辑系统插件 · ${edit.name}`
                : `编辑远程插件 · ${edit.name}`
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
