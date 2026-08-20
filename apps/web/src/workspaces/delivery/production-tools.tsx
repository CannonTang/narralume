import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, FileUp, Save, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { ErrorNote } from "../../components/error-note";
import { ConfirmDialog } from "../../components/confirm-dialog";
import {
  analyzeStoryImport,
  applyStoryImport,
  createStyleProfile,
  createWritingSkill,
  decideImportCandidate,
  deleteAgentSkill,
  deleteWritingSkill,
  discardStoryImport,
  getAgentSkills,
  getStyleProfiles,
  getStoryImport,
  getStoryImports,
  getWritingSkillPackage,
  getWritingSkills,
  importAgentSkillPackage,
  importWritingSkillPackage,
  setAgentSkillEnabled,
  updateStyleProfile,
  updateWritingSkill,
  uploadStoryFile,
  validateWritingSkill,
  type ImportBatchDetail,
  type ImportFormat,
  type ImportedAgentSkillDto,
  type StyleProfile,
  type WritingSkill,
  type WritingSkillScope,
  type WritingSkillValidation,
} from "../../lib/api";
import { projectWorkspacePath } from "../../lib/project-route";

type Tool = "styles" | "skills" | "agentSkills" | "imports";
export function ProductionTools({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<Tool>("styles");
  return <section className="production-tools"><header className="production-tools__head"><div><p className="mono">PRODUCTION ASSETS</p><h2>风格、Skill 与导入</h2></div><div className="production-tools__tabs" role="tablist">{(["styles", "skills", "agentSkills", "imports"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tool === id} onClick={() => setTool(id)}>{id === "styles" ? "风格" : id === "skills" ? "Writing Skill" : id === "agentSkills" ? "Agent Skill" : "导入管理"}</button>)}</div></header>{tool === "styles" ? <StyleManager projectId={projectId} /> : null}{tool === "skills" ? <SkillManager projectId={projectId} /> : null}{tool === "agentSkills" ? <AgentSkillManager projectId={projectId} /> : null}{tool === "imports" ? <ImportManager projectId={projectId} /> : null}</section>;
}

export function StyleManager({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient(); const query = useQuery({ queryKey: ["project", projectId, "styles"], queryFn: ({ signal }) => getStyleProfiles(projectId, signal) }); const [selectedId, setSelectedId] = useState("new"); const [showRetired, setShowRetired] = useState(false); const [archiveTarget, setArchiveTarget] = useState<StyleProfile | null>(null); const selected = query.data?.find((style) => style.id === selectedId);
  const mutation = useMutation({ mutationFn: (input: { current: StyleProfile | null; value: Parameters<typeof createStyleProfile>[1] }) => input.current ? updateStyleProfile(input.current, input.value) : createStyleProfile(projectId, input.value), onSuccess: (style) => { setSelectedId(style.id); void queryClient.invalidateQueries({ queryKey: ["project", projectId, "styles"] }); } });
  const lifecycleMutation = useMutation({ mutationFn: ({ style, status }: { style: StyleProfile; status: StyleProfile["status"] }) => updateStyleProfile(style, { status, active: false }), onSuccess: (style) => { setArchiveTarget(null); setSelectedId(style.status === "retired" && !showRetired ? "new" : style.id); void queryClient.invalidateQueries({ queryKey: ["project", projectId, "styles"] }); } });
  if (query.isPending) return <p>正在加载风格…</p>;
  if (query.isError) return <ErrorNote error={query.error} title="风格列表暂时无法加载" />;
  const visibleStyles = query.data.filter((style) => showRetired || style.status === "active");
  return <><div className="production-tools__body"><aside>{visibleStyles.map((style) => <button key={style.id} type="button" data-active={style.id === selectedId} onClick={() => setSelectedId(style.id)}>{style.name}<small>{style.status === "retired" ? "已归档" : style.active ? "启用" : "停用"} · v{style.version}</small></button>)}<button type="button" data-active={selectedId === "new"} onClick={() => setSelectedId("new")}>＋ 新风格</button><button type="button" onClick={() => { setShowRetired((value) => !value); if (showRetired && selected?.status === "retired") setSelectedId("new"); }}>{showRetired ? "隐藏已归档" : "查看已归档"}</button></aside><div><StyleForm key={`${selectedId}:${selected?.version ?? "new"}`} style={selected} pending={mutation.isPending || lifecycleMutation.isPending} error={mutation.error ?? lifecycleMutation.error} onSubmit={(value) => mutation.mutate({ current: selected ?? null, value })} />{selected ? <div className="production-tools__skill-actions">{selected.status === "active" ? <button type="button" className="btn" disabled={lifecycleMutation.isPending} onClick={() => setArchiveTarget(selected)}><Trash2 size={12} />归档风格</button> : <button type="button" className="btn" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate({ style: selected, status: "active" })}>恢复风格</button>}</div> : null}</div></div>{archiveTarget ? <ConfirmDialog title="归档风格" confirmLabel="归档" danger pending={lifecycleMutation.isPending} onCancel={() => setArchiveTarget(null)} onConfirm={() => lifecycleMutation.mutate({ style: archiveTarget, status: "retired" })}><p>归档后不会再用于新的生成任务；已有正文和历史记录不受影响，可随时恢复。</p></ConfirmDialog> : null}</>;
}
function StyleForm({ style, pending, error, onSubmit }: { style: StyleProfile | undefined; pending: boolean; error: unknown; onSubmit: (value: Parameters<typeof createStyleProfile>[1]) => void }) {
  const [name, setName] = useState(style?.name ?? ""); const [description, setDescription] = useState(style?.description ?? ""); const [rules, setRules] = useState(style?.rules.join("\n") ?? ""); const [negativeRules, setNegative] = useState(style?.negativeRules.join("\n") ?? ""); const [examples, setExamples] = useState(style?.examples.join("\n---\n") ?? ""); const [active, setActive] = useState(style?.active ?? true); const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  return <form className="production-tools__form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, description: description || null, rules: lines(rules), negativeRules: lines(negativeRules), examples: examples.split("\n---\n").map((item) => item.trim()).filter(Boolean), active }); }}><h3>{style ? "编辑风格" : "创建风格"}</h3><label>名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>描述<textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></label><label>正向规则（每行一条）<textarea required value={rules} onChange={(event) => setRules(event.target.value)} /></label><label>禁用规则（每行一条）<textarea value={negativeRules} onChange={(event) => setNegative(event.target.value)} /></label><label>示例（用 --- 分隔）<textarea value={examples} onChange={(event) => setExamples(event.target.value)} /></label><label className="production-tools__check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />启用</label>{error ? <ErrorNote error={error} title="风格未保存" /> : null}<button type="submit" className="btn btn--primary" disabled={pending}><Save size={12} />{pending ? "保存中…" : "保存风格"}</button></form>;
}

export function SkillManager({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient(); const query = useQuery({ queryKey: ["project", projectId, "writing-skills"], queryFn: ({ signal }) => getWritingSkills(projectId, signal) }); const [selectedId, setSelectedId] = useState("new"); const [validation, setValidation] = useState<WritingSkillValidation | null>(null); const [deleteTarget, setDeleteTarget] = useState<WritingSkill | null>(null); const selected = query.data?.find((skill) => skill.id === selectedId);
  const mutation = useMutation({ mutationFn: (work: () => Promise<unknown>) => work(), onSuccess: (value) => { if (value && typeof value === "object" && "checks" in value) setValidation(value as WritingSkillValidation); if (value && typeof value === "object" && "id" in value) setSelectedId(String((value as { id: unknown }).id)); void queryClient.invalidateQueries({ queryKey: ["project", projectId, "writing-skills"] }); } });
  const download = async (skill: WritingSkill) => { try { const { blob, filename } = await getWritingSkillPackage(skill.id); downloadBlob(blob, filename); } catch (error) { mutation.mutate(() => Promise.reject(error)); } };
  const importFile = async (file: File) => { const contentBase64 = await fileToBase64(file); mutation.mutate(() => importWritingSkillPackage(projectId, { filename: file.name, contentBase64 })); };
  if (query.isPending) return <p>正在加载 Writing Skill…</p>;
  if (query.isError) return <ErrorNote error={query.error} title="Writing Skill 列表暂时无法加载" />;
  return <><div className="production-tools__body"><aside>{query.data.map((skill) => <button key={skill.id} type="button" data-active={skill.id === selectedId} onClick={() => { setSelectedId(skill.id); setValidation(null); }}>{skill.name}<small>{skill.enabled ? "启用" : "停用"} · {skill.scopes.join(",")}</small></button>)}<button type="button" data-active={selectedId === "new"} onClick={() => setSelectedId("new")}>＋ 新 Skill</button><label className="production-tools__file"><FileUp size={12} />导入 .skill.zip<input type="file" accept=".zip,.skill.zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label></aside><div><SkillForm key={`${selectedId}:${selected?.version ?? "new"}`} skill={selected} pending={mutation.isPending} error={mutation.error} onSubmit={(value) => mutation.mutate(() => selected ? updateWritingSkill(selected, value) : createWritingSkill(projectId, value))} />{selected ? <div className="production-tools__skill-actions"><button type="button" className="btn" disabled={mutation.isPending} onClick={() => mutation.mutate(() => validateWritingSkill(selected.id, selected.scopes[0] ?? "all"))}><Sparkles size={12} />校验</button><button type="button" className="btn" onClick={() => void download(selected)}><Download size={12} />导出包</button><button type="button" className="btn" disabled={mutation.isPending} onClick={() => setDeleteTarget(selected)}><Trash2 size={12} />删除 Skill</button></div> : null}{validation ? <div className="production-tools__validation" data-valid={validation.valid}>{validation.checks.map((check) => <p key={check.id}>{check.passed ? "✓" : "×"} {check.message}</p>)}</div> : null}</div></div>{deleteTarget ? <ConfirmDialog title="删除 Writing Skill" confirmLabel="删除" danger pending={mutation.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={() => mutation.mutate(() => deleteWritingSkill(deleteTarget.id), { onSuccess: () => { setSelectedId("new"); setDeleteTarget(null); setValidation(null); } })}><p>这会同时删除 Skill 包内的引用资料。它只影响后续生成，不会改写已经完成的正文。</p></ConfirmDialog> : null}</>;
}
function SkillForm({ skill, pending, error, onSubmit }: { skill: WritingSkill | undefined; pending: boolean; error: unknown; onSubmit: (value: Parameters<typeof createWritingSkill>[1]) => void }) {
  const [name, setName] = useState(skill?.name ?? ""); const [description, setDescription] = useState(skill?.description ?? ""); const [instructions, setInstructions] = useState(skill?.instructions ?? ""); const [priority, setPriority] = useState(skill?.priority ?? 0); const [enabled, setEnabled] = useState(skill?.enabled ?? true); const [scopes, setScopes] = useState<WritingSkillScope[]>(skill?.scopes ?? ["all"]); const allScopes: WritingSkillScope[] = ["all", "chapter", "cocreate", "edit", "review"];
  return <form className="production-tools__form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, description: description || null, instructions, scopes, priority, enabled }); }}><h3>{skill ? "编辑 Writing Skill" : "创建 Writing Skill"}</h3><label>名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>描述<textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></label><label>指令<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><fieldset><legend>Scope</legend>{allScopes.map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])} />{scope}</label>)}</fieldset><label>优先级<input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label><label className="production-tools__check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用</label>{error ? <ErrorNote error={error} title="Writing Skill 操作未完成" /> : null}<button type="submit" className="btn btn--primary" disabled={pending || scopes.length === 0}><Save size={12} />保存 Skill</button></form>;
}

export function ImportManager({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<{ projectId: string; batchId: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [appliedProjectId, setAppliedProjectId] = useState<string | null>(null);
  const analysisRequestRef = useRef<{ batchId: string; requestId: string } | null>(null);
  const batchesQuery = useQuery({
    queryKey: ["project", projectId, "imports"],
    queryFn: ({ signal }) => getStoryImports(projectId, signal),
  });
  const selectedBatchId = selection?.projectId === projectId
    ? selection.batchId
    : batchesQuery.data?.[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ["import", selectedBatchId],
    queryFn: ({ signal }) => getStoryImport(selectedBatchId!, signal),
    enabled: Boolean(selectedBatchId),
    refetchInterval: (query) => query.state.data?.batch.status === "analyzing" ? 1_500 : false,
  });
  const detail = detailQuery.data ?? null;
  const mutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: (value) => {
      let nextDetail: ImportBatchDetail | null = null;
      if (value && typeof value === "object" && "batch" in value) {
        nextDetail = value as ImportBatchDetail;
      }
      if (value && typeof value === "object" && "detail" in value) {
        const result = value as { detail: ImportBatchDetail; projectId?: string };
        nextDetail = result.detail;
        if (result.projectId) setAppliedProjectId(result.projectId);
      }
      if (nextDetail) {
        setSelection({ projectId, batchId: nextDetail.batch.id });
        queryClient.setQueryData(["import", nextDetail.batch.id], nextDetail);
      }
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "imports"] });
      if (selectedBatchId) {
        void queryClient.invalidateQueries({ queryKey: ["import", selectedBatchId] });
      }
    },
  });
  const upload = async (file: File) => { setAppliedProjectId(null); mutation.mutate(() => uploadStoryFile(file, projectId, importFormat(file.name), (received, total) => setUploadProgress(Math.round(received / total * 100)))); };
  const selectedIds = detail?.candidates.filter((candidate) => candidate.status === "selected" || candidate.status === "pending").map((candidate) => candidate.id) ?? [];
  const terminal = Boolean(detail && ["applied", "discarded"].includes(detail.batch.status));
  return <div className="production-tools__import"><label className="production-tools__drop"><FileUp size={18} />上传旧稿到当前项目<input type="file" accept=".md,.txt,.docx,.html,.htm,.epub,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /><span>{mutation.isPending ? `处理中 ${uploadProgress}%` : "支持 Markdown、文本、DOCX、HTML、EPUB、作品包"}</span></label>{batchesQuery.isError ? <ErrorNote error={batchesQuery.error} title="导入批次暂时无法加载" /> : null}{batchesQuery.data?.length ? <label>历史导入批次<select aria-label="选择导入批次" value={selectedBatchId ?? ""} onChange={(event) => setSelection({ projectId, batchId: event.target.value })}>{batchesQuery.data.map((batch) => <option key={batch.id} value={batch.id}>{batch.filename} · {batch.status}</option>)}</select></label> : null}{mutation.isError ? <ErrorNote error={mutation.error} title="导入操作未完成" /> : null}{detailQuery.isPending && selectedBatchId ? <p>正在恢复导入批次…</p> : detailQuery.isError ? <ErrorNote error={detailQuery.error} title="导入批次详情暂时无法加载" /> : detail ? <><header className="production-tools__import-head"><div><h3>{detail.batch.filename}</h3><p>{detail.batch.format} · {detail.batch.sourceCharacters} 字 · {detail.batch.sourceHash}</p></div><span>{detail.batch.status}</span></header><div className="production-tools__candidates">{detail.candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" disabled={terminal || candidate.status === "applied"} checked={candidate.status === "selected" || candidate.status === "pending"} onChange={(event) => mutation.mutate(() => decideImportCandidate(candidate.id, event.target.checked ? "selected" : "discarded"))} /><span>{candidate.kind}</span><strong>{candidate.title}</strong><small>{candidate.status}</small></label>)}</div><div className="production-tools__import-actions"><button type="button" className="btn" disabled={mutation.isPending || terminal || detail.batch.status === "analyzing"} onClick={() => { const requestId = analysisRequestRef.current?.batchId === detail.batch.id ? analysisRequestRef.current.requestId : crypto.randomUUID(); analysisRequestRef.current = { batchId: detail.batch.id, requestId }; mutation.mutate(() => analyzeStoryImport(detail.batch.id, requestId, { qualityPreset: "standard" }).then((result) => { analysisRequestRef.current = null; return result; })); }}>AI 分析</button><button type="button" className="btn btn--primary" disabled={mutation.isPending || selectedIds.length === 0 || terminal || detail.batch.status === "analyzing"} onClick={() => mutation.mutate(() => applyStoryImport(detail.batch.id, selectedIds))}>应用 {selectedIds.length} 项</button><button type="button" className="btn" disabled={mutation.isPending || terminal} onClick={() => mutation.mutate(() => discardStoryImport(detail.batch.id))}>丢弃批次</button><button type="button" className="btn" disabled={mutation.isPending || detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>从服务端刷新</button></div>{detail.batch.analysisRunId ? <Link to={`${projectWorkspacePath(projectId, "runs")}?run=${encodeURIComponent(detail.batch.analysisRunId)}`}>查看分析运行</Link> : null}{appliedProjectId ? <p role="status">导入已应用。<Link to={projectWorkspacePath(appliedProjectId, "bible")}>打开目标项目</Link></p> : null}</> : batchesQuery.isSuccess ? <p>还没有导入批次。</p> : null}</div>;
}

function importFormat(filename: string): ImportFormat { const ext = filename.split(".").pop()?.toLowerCase(); if (ext === "txt") return "text"; if (ext === "docx") return "docx"; if (ext === "html" || ext === "htm") return "html"; if (ext === "epub") return "epub"; if (ext === "json") return "narrative-bundle"; return "markdown"; }
function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); }); }
function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); }

export function AgentSkillManager({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["project", projectId, "agent-skills"],
    queryFn: ({ signal }) => getAgentSkills(projectId, signal),
  });
  const mutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "agent-skills"],
      });
    },
  });
  const importFile = async (file: File) => {
    const contentBase64 = await fileToBase64(file);
    mutation.mutate(() =>
      importAgentSkillPackage(projectId, { filename: file.name, contentBase64 })
    );
  };
  if (query.isPending) return <p>正在加载 Agent Skill…</p>;
  if (query.isError) {
    return <ErrorNote error={query.error} title="Agent Skill 列表暂时无法加载" />;
  }
  return (
    <div className="production-tools__agent-skills">
      <p className="production-tools__hint">
        导入的 Agent Skill 只声明触发说明、指令与只读/候选型能力白名单；
        正式正文与 Canon 采纳仍由系统内置裁定边界确认。包格式：ZIP
        内含 agent-skill.json 与 INSTRUCTIONS.md。
      </p>
      <label className="production-tools__file">
        <FileUp size={12} />导入 Agent Skill 包
        <input
          type="file"
          accept=".zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {mutation.isError ? (
        <ErrorNote error={mutation.error} title="Agent Skill 操作未完成" />
      ) : null}
      {query.data.length === 0 ? (
        <p className="production-tools__empty">还没有导入的 Agent Skill。</p>
      ) : (
        <ul className="production-tools__agent-skill-list">
          {query.data.map((skill) => (
            <AgentSkillRow
              key={skill.id}
              skill={skill}
              pending={mutation.isPending}
              onToggle={(enabled) =>
                mutation.mutate(() => setAgentSkillEnabled(skill, enabled))
              }
              onDelete={() => mutation.mutate(() => deleteAgentSkill(skill.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentSkillRow({
  skill,
  pending,
  onToggle,
  onDelete,
}: {
  skill: ImportedAgentSkillDto;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li data-enabled={skill.enabled}>
      <div className="production-tools__agent-skill-main">
        <strong>
          <Bot size={13} />
          {skill.label}
          <small>v{skill.version}</small>
        </strong>
        <p>{skill.description}</p>
        <div className="production-tools__agent-skill-caps">
          {skill.allowedCapabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
      </div>
      <div className="production-tools__agent-skill-actions">
        <label className="production-tools__check">
          <input
            type="checkbox"
            disabled={pending}
            checked={skill.enabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          启用
        </label>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={12} />删除
        </button>
      </div>
      {confirming ? (
        <ConfirmDialog
          title={`删除 Agent Skill「${skill.label}」`}
          confirmLabel="删除"
          danger
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
        >
          <p>删除后该技能不再出现在助手会话中，此操作不可撤销。</p>
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
