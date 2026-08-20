import "../../styles/bible-actions.css";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PenLine, Save, Search, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { ErrorNote } from "../../components/error-note";
import {
  createCanonEntity,
  createCanonFact,
  createForeshadow,
  createOutlineNode,
  createRelationshipEvent,
  createTimelineEvent,
  previewContext,
  promoteCanonFact,
  reviseCanonFact,
  removeCanonEntity,
  removeForeshadow,
  removeOutlineNode,
  removeRelationshipEvent,
  removeTimelineEvent,
  updateAuthorIntent,
  updateCanonEntity,
  updateForeshadow,
  updateOutlineNode,
  updateTimelineEvent,
  withdrawCanonFact,
  type CanonEntity,
  type CanonFact,
  type ContextPreview,
  type Foreshadow,
  type OutlineNode,
  type StoryBible,
} from "../../lib/api";
import { projectWorkspacePath } from "../../lib/project-route";

export type BibleEditorSection =
  | "intent"
  | "outline"
  | "entities"
  | "facts"
  | "relations"
  | "timeline"
  | "foreshadows";

const SECTION_LABELS: Record<BibleEditorSection, string> = {
  intent: "作者意图",
  outline: "大纲",
  entities: "实体",
  facts: "正典事实",
  relations: "关系",
  timeline: "时间线",
  foreshadows: "伏笔",
};

type MutationWork = {
  execute: () => Promise<unknown>;
  kind: "write" | "preview";
};

export function BibleEditor({
  projectId,
  bible,
  section,
}: {
  projectId: string;
  bible: StoryBible;
  section: BibleEditorSection;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (work: MutationWork) => work.execute(),
    onSuccess: (value, work) => {
      setResult(work.kind === "preview" ? value : null);
      setNotice(
        isRemoval(value)
          ? removalNotice(value.disposition)
          : work.kind === "preview"
          ? "上下文已整理完成。"
          : "已写入服务端，故事圣经已刷新。",
      );
      if (work.kind === "write") {
        void queryClient.invalidateQueries({
          queryKey: ["project", projectId, "bible"],
        });
      }
    },
  });
  const run = (
    execute: () => Promise<unknown>,
    kind: MutationWork["kind"] = "write",
  ) => {
    setNotice(null);
    setResult(null);
    mutation.mutate({ execute, kind });
  };
  return (
    <section className="bible-actions" aria-label={`${SECTION_LABELS[section]}编辑`}>
      <header className="bible-actions__head">
        <div>
          <p className="bible-actions__eyebrow">EDIT · {SECTION_LABELS[section]}</p>
          <h2>编辑此页</h2>
        </div>
        <p className="bible-actions__note">修改只作用于当前分页，并在保存后成为权威内容。</p>
      </header>
      <div className="bible-actions__panel">
        {section === "intent" ? <IntentForm key={bible.intent?.updatedAt ?? "intent:none"} bible={bible} pending={mutation.isPending} onSubmit={(input) => run(() => updateAuthorIntent(projectId, { ...input, expectedUpdatedAt: bible.intent?.updatedAt ?? null }))} /> : null}
        {section === "outline" ? <OutlineForm bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} projectId={projectId} /> : null}
        {section === "entities" ? <EntityForm bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} projectId={projectId} /> : null}
        {section === "facts" ? <FactForm bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} projectId={projectId} /> : null}
        {section === "relations" ? <RelationForm projectId={projectId} bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} /> : null}
        {section === "timeline" ? <TimelineForm bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} projectId={projectId} /> : null}
        {section === "foreshadows" ? <ForeshadowForm bible={bible} pending={mutation.isPending} onSave={(work) => run(work)} projectId={projectId} /> : null}
        {mutation.isError ? <ErrorNote error={mutation.error} title="这次写入没有完成" /> : null}
        {notice ? <p className="bible-actions__notice" role="status">{notice}</p> : null}
        <details className="bible-actions__context">
          <summary>
            <Search size={14} strokeWidth={1.6} aria-hidden="true" />
            预览 AI 将获得的上下文
          </summary>
          <div className="bible-actions__context-body">
            <ContextForm
              bible={bible}
              pending={mutation.isPending}
              onSubmit={(input) =>
                run(() => previewContext(projectId, input), "preview")
              }
            />
            {result ? <ContextResult value={result as ContextPreview} /> : null}
          </div>
        </details>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="bible-actions__field"><span>{label}</span>{children}</label>;
}
function Buttons({ pending, children, save = true }: { pending: boolean; children?: ReactNode; save?: boolean }) {
  return <div className="bible-actions__buttons">{children}{save ? <button type="submit" className="btn btn--primary" disabled={pending}><Save size={13} />{pending ? "提交中…" : "保存"}</button> : null}</div>;
}
function RemoveResourceButton({ pending, label = "移除", onConfirm }: { pending: boolean; label?: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return <>{<button type="button" className="btn" disabled={pending} onClick={() => setOpen(true)}><Trash2 size={13} />{label}</button>}{open ? <ConfirmDialog title={`确认${label}`} confirmLabel={label} danger pending={pending} onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); onConfirm(); }}><p>系统会先检查引用。尚未使用的内容会直接删除；已经进入正文或其他故事资料的内容会保留历史，并标为放弃、退役或作废。</p></ConfirmDialog> : null}</>;
}
function isRemoval(value: unknown): value is { disposition: "deleted" | "abandoned" | "retired" | "voided" } {
  return Boolean(value && typeof value === "object" && "disposition" in value);
}
function removalNotice(disposition: "deleted" | "abandoned" | "retired" | "voided"): string {
  return disposition === "deleted" ? "尚未被引用，已直接删除。" : disposition === "abandoned" ? "已有故事引用，已保留记录并标为放弃。" : disposition === "retired" ? "已有故事引用，已保留记录并退役。" : "已有历史或引用，已保留记录并作废。";
}
const comma = (value: string) => value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);

function IntentForm({ bible, pending, onSubmit }: { bible: StoryBible; pending: boolean; onSubmit: (input: Record<string, unknown>) => void }) {
  const intent = bible.intent;
  const [promise, setPromise] = useState(intent?.promise ?? "");
  const [themes, setThemes] = useState(intent?.themes.join("，") ?? "");
  const [audience, setAudience] = useState(intent?.audience ?? "");
  const [tone, setTone] = useState(intent?.tone ?? "");
  const [boundaries, setBoundaries] = useState(intent?.boundaries.join("，") ?? "");
  const [endingDirection, setEndingDirection] = useState(intent?.endingDirection ?? "");
  const [currentFocus, setCurrentFocus] = useState(intent?.currentFocus ?? "");
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSubmit({ promise, themes: comma(themes), audience, tone, boundaries: comma(boundaries), endingDirection, currentFocus, lockedFields: intent?.lockedFields ?? [] }); }}>
    <Field label="创作承诺"><textarea required value={promise} onChange={(event) => setPromise(event.target.value)} /></Field>
    <Field label="主题（逗号分隔）"><input value={themes} onChange={(event) => setThemes(event.target.value)} /></Field>
    <Field label="读者"><input value={audience} onChange={(event) => setAudience(event.target.value)} /></Field>
    <Field label="语气"><input value={tone} onChange={(event) => setTone(event.target.value)} /></Field>
    <Field label="边界（逗号分隔）"><input value={boundaries} onChange={(event) => setBoundaries(event.target.value)} /></Field>
    <Field label="结局方向"><textarea value={endingDirection} onChange={(event) => setEndingDirection(event.target.value)} /></Field>
    <Field label="当前焦点"><input value={currentFocus} onChange={(event) => setCurrentFocus(event.target.value)} /></Field><Buttons pending={pending} />
  </form>;
}

function OutlineForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new");
  const selected = bible.outline.find((node) => node.id === selectedId);
  // key 绑定资源身份与版本：查询刷新或 AI 候选采纳后字段和并发令牌一起重置，
  // 避免旧表单内容配合新 updatedAt 静默覆盖（CR-65）。
  return <OutlineFields key={`${selectedId}@${selected?.updatedAt ?? "new"}`} projectId={projectId} bible={bible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} />;
}

const OUTLINE_CHILD_KINDS: Readonly<Record<OutlineNode["kind"], readonly OutlineNode["kind"][]>> = {
  book: ["volume", "arc", "chapter"],
  volume: ["arc", "chapter"],
  arc: ["chapter", "scene"],
  chapter: ["scene", "beat"],
  scene: ["beat"],
  beat: [],
};
const OUTLINE_KIND_LABELS: Readonly<Record<OutlineNode["kind"], string>> = {
  book: "全书",
  volume: "卷",
  arc: "情节弧",
  chapter: "章节",
  scene: "场景",
  beat: "节拍",
};

function OutlineFields({ projectId, bible, selected, pending, onSave, onSelect }: { projectId: string; bible: StoryBible; selected: OutlineNode | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const root = bible.outline.find((node) => node.kind === "book") ?? bible.outline[0];
  const [parentId, setParentId] = useState(selected?.parentId ?? root?.id ?? "");
  const initialParent = bible.outline.find((node) => node.id === (selected?.parentId ?? root?.id));
  const [kind, setKind] = useState<OutlineNode["kind"]>(selected?.kind ?? (initialParent ? OUTLINE_CHILD_KINDS[initialParent.kind][0] : undefined) ?? "chapter");
  const [title, setTitle] = useState(selected?.title ?? "");
  const [summary, setSummary] = useState(selected?.summary ?? "");
  const [goal, setGoal] = useState(selected?.goal ?? "");
  const [conflict, setConflict] = useState(selected?.conflict ?? "");
  const validParents = bible.outline.filter((node) => OUTLINE_CHILD_KINDS[node.kind].length > 0);
  const parent = validParents.find((node) => node.id === parentId);
  const allowedKinds = parent ? OUTLINE_CHILD_KINDS[parent.kind] : [];

  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSave(() => selected ? updateOutlineNode(projectId, selected.id, { title, summary: summary || null, goal: goal || null, conflict: conflict || null, expectedUpdatedAt: selected.updatedAt }) : createOutlineNode(projectId, { parentId, kind, ordinal: bible.outline.filter((node) => node.parentId === parentId).length, title, summary: summary || null, metadata: {} })); }}>
    <Field label="编辑对象"><select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">新建节点</option>{bible.outline.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field>
    {!selected ? <><Field label="父节点"><select required value={parentId} onChange={(event) => { const nextParent = validParents.find((node) => node.id === event.target.value); setParentId(event.target.value); if (nextParent) setKind(OUTLINE_CHILD_KINDS[nextParent.kind][0]!); }}>{validParents.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field><Field label="类型"><select value={kind} onChange={(event) => setKind(event.target.value as OutlineNode["kind"])}>{allowedKinds.map((value) => <option key={value} value={value}>{OUTLINE_KIND_LABELS[value]}</option>)}</select></Field>{parent ? <p className="bible-actions__note">{OUTLINE_KIND_LABELS[parent.kind]}下可建：{allowedKinds.map((value) => OUTLINE_KIND_LABELS[value]).join("、")}</p> : null}</> : null}
    <Field label="标题"><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
    <Field label="摘要"><textarea value={summary ?? ""} onChange={(event) => setSummary(event.target.value)} /></Field>
    {selected ? <><Field label="目标"><input value={goal ?? ""} onChange={(event) => setGoal(event.target.value)} /></Field><Field label="冲突"><input value={conflict ?? ""} onChange={(event) => setConflict(event.target.value)} /></Field></> : null}
    <Buttons pending={pending}>{selected && selected.kind !== "book" ? <RemoveResourceButton pending={pending} label={selected.status === "abandoned" ? "删除未引用节点" : "移除节点"} onConfirm={() => onSave(() => removeOutlineNode(projectId, selected))} /> : null}{selected?.kind === "chapter" ? <Link className="btn" to={`${projectWorkspacePath(projectId, "studio")}?outline=${encodeURIComponent(selected.id)}`}><PenLine size={13} />去写作台写本章</Link> : null}</Buttons>
  </form>;
}

// 选项与后端契约枚举对齐（CR-17）：type 为 character/location/organization/item/rule/concept，
// status 为 active/retired；onChange 用 find 取代类型断言，让漂移在编译期暴露。
const ENTITY_TYPE_OPTIONS: readonly { value: CanonEntity["type"]; label: string }[] = [
  { value: "character", label: "人物" },
  { value: "location", label: "地点" },
  { value: "organization", label: "组织" },
  { value: "item", label: "物件" },
  { value: "rule", label: "规则" },
  { value: "concept", label: "概念" },
];
const ENTITY_STATUS_OPTIONS: readonly { value: CanonEntity["status"]; label: string }[] = [
  { value: "active", label: "活跃" },
  { value: "retired", label: "停用" },
];

function EntityForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new");
  const selected = bible.entities.find((entity) => entity.id === selectedId);
  return <EntityFields key={`${selectedId}@${selected?.updatedAt ?? "new"}`} projectId={projectId} bible={bible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} />;
}
function EntityFields({ projectId, bible, selected, pending, onSave, onSelect }: { projectId: string; bible: StoryBible; selected: CanonEntity | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const [type, setType] = useState<CanonEntity["type"]>(selected?.type ?? "character"); const [name, setName] = useState(selected?.name ?? ""); const [aliases, setAliases] = useState(selected?.aliases.join("，") ?? ""); const [description, setDescription] = useState(selected?.description ?? ""); const [status, setStatus] = useState<CanonEntity["status"]>(selected?.status ?? "active");
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSave(() => selected ? updateCanonEntity(projectId, selected.id, { name, aliases: comma(aliases), description: description || null, attributes: selected.attributes, status, expectedUpdatedAt: selected.updatedAt }) : createCanonEntity(projectId, { type, name, aliases: comma(aliases), description: description || null, attributes: {} })); }}>
    <Field label="编辑对象"><select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">新建实体</option>{bible.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field>
    {!selected ? <Field label="类型"><select value={type} onChange={(event) => { const option = ENTITY_TYPE_OPTIONS.find((item) => item.value === event.target.value); if (option) setType(option.value); }}>{ENTITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}
    <Field label="名称"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="别名"><input value={aliases} onChange={(event) => setAliases(event.target.value)} /></Field><Field label="描述"><textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></Field>
    {selected ? <Field label="状态"><select value={status} onChange={(event) => { const option = ENTITY_STATUS_OPTIONS.find((item) => item.value === event.target.value); if (option) setStatus(option.value); }}>{ENTITY_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field> : null}<Buttons pending={pending}>{selected ? <RemoveResourceButton pending={pending} label="移除实体" onConfirm={() => onSave(() => removeCanonEntity(projectId, selected))} /> : null}</Buttons>
  </form>;
}

function FactForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new"); const selected = bible.facts.find((fact) => fact.id === selectedId);
  return <FactFields key={`${selectedId}@${selected?.createdAt ?? "new"}`} projectId={projectId} bible={bible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} />;
}
function FactFields({ projectId, bible, selected, pending, onSave, onSelect }: { projectId: string; bible: StoryBible; selected: CanonFact | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const [subjectId, setSubjectId] = useState(selected?.subjectId ?? bible.entities[0]?.id ?? ""); const [predicate, setPredicate] = useState(selected?.predicate ?? ""); const [value, setValue] = useState(typeof selected?.value === "string" ? selected.value : selected?.value ? JSON.stringify(selected.value) : ""); const [objectMode, setObjectMode] = useState<"value" | "entity">(selected?.objectEntityId ? "entity" : "value"); const [objectEntityId, setObjectEntityId] = useState(selected?.objectEntityId ?? bible.entities[0]?.id ?? ""); const [authority, setAuthority] = useState<CanonFact["authority"]>(selected?.authority ?? "confirmed"); const [reason, setReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"revise" | "withdraw" | null>(null);
  // 契约要求 objectEntityId 与 value 必须且只能提供一个（CR-18）：实体宾语模式下省略 value，文本模式下 objectEntityId 置 null。
  const saveRevision = (confirmLockedRevision: boolean) => {
    if (!selected) return;
    const object = objectMode === "entity" ? { objectEntityId } : { objectEntityId: null, value };
    onSave(() => reviseCanonFact(projectId, selected.id, { subjectId, predicate, ...object, validFromNodeId: selected.validFromNodeId, validToNodeId: selected.validToNodeId, knowledgeScope: selected.knowledgeScope, knowledgeSubjectId: selected.knowledgeSubjectId, authority, confidence: selected.confidence, confirmLockedRevision }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) {
      const object = objectMode === "entity" ? { objectEntityId } : { objectEntityId: null, value };
      onSave(() => createCanonFact(projectId, { subjectId, predicate, ...object, authority, knowledgeScope: "omniscient", confidence: 1 }));
    } else if (selected.authority === "locked") {
      setConfirmAction("revise");
    } else {
      saveRevision(false);
    }
  };
  const withdraw = (confirmLockedWithdrawal: boolean) => {
    if (!selected) return;
    onSave(() => withdrawCanonFact(projectId, selected.id, { reason: reason.trim(), confirmLockedWithdrawal }));
  };
  return <><form className="bible-actions__form" onSubmit={submit}><Field label="编辑对象"><select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">新建事实</option>{bible.facts.map((fact) => <option key={fact.id} value={fact.id}>{fact.predicate}</option>)}</select></Field><Field label="主体"><select required value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{bible.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><Field label="谓词"><input required value={predicate} onChange={(event) => setPredicate(event.target.value)} /></Field><Field label="宾语"><select value={objectMode} onChange={(event) => setObjectMode(event.target.value === "entity" ? "entity" : "value")}><option value="value">文本值</option><option value="entity">实体</option></select></Field>{objectMode === "entity" ? <Field label="宾语实体"><select required value={objectEntityId} onChange={(event) => setObjectEntityId(event.target.value)}>{bible.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field> : <Field label="值"><input required value={value} onChange={(event) => setValue(event.target.value)} /></Field>}<Field label="权威"><select value={authority} onChange={(event) => setAuthority(event.target.value as CanonFact["authority"])}><option value="candidate">候选</option><option value="inferred">推断</option><option value="confirmed">确认</option><option value="locked">锁定</option></select></Field>
    {selected ? <><Field label="撤回原因"><input value={reason} onChange={(event) => setReason(event.target.value)} /></Field><div className="bible-actions__buttons"><button type="button" className="btn" disabled={pending || selected.authority === "locked"} onClick={() => onSave(() => promoteCanonFact(projectId, selected.id, selected.authority === "candidate" ? "inferred" : selected.authority === "inferred" ? "confirmed" : "locked"))}>提升权威</button><button type="button" className="btn" disabled={pending || !reason.trim()} onClick={() => selected.authority === "locked" ? setConfirmAction("withdraw") : withdraw(false)}>撤回事实</button></div></> : null}<Buttons pending={pending} />
  </form>{confirmAction ? <ConfirmDialog title={confirmAction === "revise" ? "修改锁定事实" : "撤回锁定事实"} confirmLabel={confirmAction === "revise" ? "确认修改" : "确认撤回"} danger={confirmAction === "withdraw"} pending={pending} onCancel={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction; setConfirmAction(null); if (action === "revise") saveRevision(true); else withdraw(true); }}><p>锁定事实会影响后续正文、审稿和故事状态。确认后将立即写入新的权威事实。</p></ConfirmDialog> : null}</>;
}

function RelationForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new"); const selected = bible.relationships.find((item) => item.id === selectedId); const [fromEntityId, setFrom] = useState(bible.entities[0]?.id ?? ""); const [toEntityId, setTo] = useState(bible.entities[1]?.id ?? bible.entities[0]?.id ?? ""); const [relation, setRelation] = useState(""); const [storyTime, setStoryTime] = useState("");
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); if (!selected) onSave(() => createRelationshipEvent(projectId, { fromEntityId, toEntityId, relation, intensity: null, state: {}, outlineNodeId: null, storyTime: storyTime || null, sourceId: null })); }}><Field label="编辑对象"><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="new">新建关系</option>{bible.relationships.map((item) => <option key={item.id} value={item.id}>{item.relation}</option>)}</select></Field>{selected ? <><Field label="关系双方"><input disabled value={`${bible.entities.find((item) => item.id === selected.fromEntityId)?.name ?? "未知"} → ${bible.entities.find((item) => item.id === selected.toEntityId)?.name ?? "未知"}`} /></Field><Field label="关系"><input disabled value={selected.relation} /></Field></> : <><Field label="来源实体"><select value={fromEntityId} onChange={(event) => setFrom(event.target.value)}>{bible.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><Field label="目标实体"><select value={toEntityId} onChange={(event) => setTo(event.target.value)}>{bible.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><Field label="关系"><input required value={relation} onChange={(event) => setRelation(event.target.value)} /></Field><Field label="故事时间"><input value={storyTime} onChange={(event) => setStoryTime(event.target.value)} /></Field></>}<Buttons pending={pending} save={!selected}>{selected ? <RemoveResourceButton pending={pending} label="作废关系" onConfirm={() => onSave(() => removeRelationshipEvent(projectId, selected))} /> : null}</Buttons></form>;
}

function TimelineForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new"); const selected = bible.timeline.find((event) => event.id === selectedId);
  return <TimelineFields key={`${selectedId}@${selected?.updatedAt ?? "new"}`} projectId={projectId} bible={bible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} />;
}
function TimelineFields({ projectId, bible, selected, pending, onSave, onSelect }: { projectId: string; bible: StoryBible; selected: StoryBible["timeline"][number] | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const [title, setTitle] = useState(selected?.title ?? ""); const [description, setDescription] = useState(selected?.description ?? ""); const [start, setStart] = useState(selected?.storyTimeStart ?? ""); const [end, setEnd] = useState(selected?.storyTimeEnd ?? "");
  const payload = () => ({ title, description: description || null, outlineNodeId: selected?.outlineNodeId ?? null, storyTimeStart: start, storyTimeEnd: end || null, sequence: selected?.sequence ?? bible.timeline.length, participants: selected?.participants ?? [], causes: selected?.causes ?? [], visibility: selected?.visibility ?? "omniscient" as const, sourceId: selected?.sourceId ?? null });
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSave(() => selected ? updateTimelineEvent(projectId, selected.id, { ...payload(), expectedUpdatedAt: selected.updatedAt }) : createTimelineEvent(projectId, payload())); }}><Field label="编辑对象"><select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">新建事件</option>{bible.timeline.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="标题"><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="描述"><textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="开始"><input required value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="结束"><input value={end ?? ""} onChange={(event) => setEnd(event.target.value)} /></Field><Buttons pending={pending}>{selected ? <RemoveResourceButton pending={pending} label="移除事件" onConfirm={() => onSave(() => removeTimelineEvent(projectId, selected))} /> : null}</Buttons></form>;
}

function ForeshadowForm({ projectId, bible, pending, onSave }: { projectId: string; bible: StoryBible; pending: boolean; onSave: (work: () => Promise<unknown>) => void }) {
  const [selectedId, setSelectedId] = useState("new"); const selected = bible.foreshadows.find((item) => item.id === selectedId);
  return <ForeshadowFields key={`${selectedId}@${selected?.updatedAt ?? "new"}`} projectId={projectId} bible={bible} selected={selected} pending={pending} onSave={onSave} onSelect={setSelectedId} />;
}
function ForeshadowFields({ projectId, bible, selected, pending, onSave, onSelect }: { projectId: string; bible: StoryBible; selected: Foreshadow | undefined; pending: boolean; onSave: (work: () => Promise<unknown>) => void; onSelect: (id: string) => void }) {
  const [title, setTitle] = useState(selected?.title ?? ""); const [description, setDescription] = useState(selected?.description ?? ""); const [status, setStatus] = useState<Foreshadow["status"]>(selected?.status ?? "planned"); const [importance, setImportance] = useState<Foreshadow["importance"]>(selected?.importance ?? 3);
  const payload = () => ({ title, description, status, importance, dependencies: selected?.dependencies ?? [], evidenceNodeIds: selected?.evidenceNodeIds ?? [], targetFromNodeId: selected?.targetFromNodeId ?? null, targetToNodeId: selected?.targetToNodeId ?? null, resolutionNodeId: selected?.resolutionNodeId ?? null });
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSave(() => selected ? updateForeshadow(projectId, selected.id, { ...payload(), expectedUpdatedAt: selected.updatedAt }) : createForeshadow(projectId, payload())); }}><Field label="编辑对象"><select value={selected?.id ?? "new"} onChange={(event) => onSelect(event.target.value)}><option value="new">新建伏笔</option>{bible.foreshadows.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="标题"><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="描述"><textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="状态"><select value={status} onChange={(event) => setStatus(event.target.value as Foreshadow["status"])}><option value="planned">计划</option><option value="planted">已埋</option><option value="developing">发展</option><option value="resolved">回收</option><option value="abandoned">放弃</option></select></Field><Field label="重要度"><input type="number" min="1" max="5" value={importance} onChange={(event) => setImportance(Number(event.target.value) as Foreshadow["importance"])} /></Field><Buttons pending={pending}>{selected ? <RemoveResourceButton pending={pending} label="移除伏笔" onConfirm={() => onSave(() => removeForeshadow(projectId, selected))} /> : null}</Buttons></form>;
}

function ContextForm({ bible, pending, onSubmit }: { bible: StoryBible; pending: boolean; onSubmit: (input: Parameters<typeof previewContext>[1]) => void }) {
  const [task, setTask] = useState("chapter-draft"); const [query, setQuery] = useState(""); const [nodeId, setNodeId] = useState(""); const [entityIds, setEntityIds] = useState<string[]>([]);
  return <form className="bible-actions__form" onSubmit={(event) => { event.preventDefault(); onSubmit({ task, query, entityIds, currentOutlineNodeId: nodeId || null, access: { audience: "author", includeCandidates: true } }); }}><Field label="任务"><input value={task} onChange={(event) => setTask(event.target.value)} /></Field><Field label="检索问题"><textarea required value={query} onChange={(event) => setQuery(event.target.value)} /></Field><Field label="当前大纲"><select value={nodeId} onChange={(event) => setNodeId(event.target.value)}><option value="">无</option>{bible.outline.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field><fieldset className="bible-actions__checks"><legend>实体范围</legend>{bible.entities.map((entity) => <label key={entity.id}><input type="checkbox" checked={entityIds.includes(entity.id)} onChange={() => setEntityIds((current) => current.includes(entity.id) ? current.filter((id) => id !== entity.id) : [...current, entity.id])} />{entity.name}</label>)}</fieldset><Buttons pending={pending} /></form>;
}
function ContextResult({ value }: { value: ContextPreview }) {
  return <div className="bible-actions__result"><h3>上下文收据</h3><pre>{JSON.stringify(value, null, 2)}</pre></div>;
}
