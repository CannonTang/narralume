/* 故事圣经：单页 Canon Spread。左侧辑签负责切换主题，右侧同一张纸幅
   同时承载稳定的阅读面与显式的人工编辑，不再叠放七个板块和独立控制台。 */

import "../styles/bible.css";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ErrorNote } from "../components/error-note";
import { PageBand } from "../components/page-band";
import { ProjectRequiredState } from "../components/project-required-state";
import { Skeleton } from "../components/skeleton";
import { getStoryBible, type StoryBible } from "../lib/api";
import {
  entityTypeLabel,
  factAuthorityLabel,
  foreshadowStatusLabel,
  outlineKindLabel,
  outlineStatusLabel,
  projectPhaseLabel,
} from "../lib/labels";
import { useProjectId } from "../lib/project-route";
import { BibleEditor, type BibleEditorSection } from "./bible/editor";
import { CanonCandidatePanel } from "./bible/candidate-panel";

export type BibleSectionId = BibleEditorSection;

const SECTION_TABS: { id: BibleSectionId; name: string; en: string }[] = [
  { id: "intent", name: "意图", en: "INTENT" },
  { id: "outline", name: "大纲", en: "OUTLINE" },
  { id: "entities", name: "实体", en: "CANON" },
  { id: "facts", name: "正典", en: "FACTS" },
  { id: "relations", name: "关系", en: "LINKS" },
  { id: "timeline", name: "时间线", en: "TIMELINE" },
  { id: "foreshadows", name: "伏笔", en: "FORESHADOW" },
];

export function BibleWorkspace() {
  const projectId = useProjectId();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("spread");
  const [activeSectionState, setActiveSectionState] =
    useState<BibleSectionId>(() => bibleSection(requestedSection));
  const activeSection = bibleSection(requestedSection ?? activeSectionState);
  const setActiveSection = (section: BibleSectionId) => {
    setActiveSectionState(section);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("spread", section);
        return next;
      },
      { replace: true },
    );
  };
  const query = useQuery({
    queryKey: ["project", projectId, "bible"],
    queryFn: ({ signal }) => getStoryBible(projectId!, signal),
    enabled: Boolean(projectId),
  });

  const bible = query.data;

  if (!projectId) {
    return (
      <div className="bible">
        <ProjectRequiredState
          seal="典"
          title="故事"
          description="选定作品后，在这里整理创作意图、人物、大纲和长期有效的故事事实。"
        />
      </div>
    );
  }

  return (
    <div className="bible">
      <PageBand
        index="CANON · 03"
        title="故事圣经"
        meta={
          bible ? (
            <>
              <span>
                {bible.project.title} · {projectPhaseLabel(bible.project.phase)} ·{" "}
                {bible.project.language}
              </span>
              <span className="mono" aria-label="编目数">
                {bible.outline.length} 节 · {bible.entities.length} 体 ·{" "}
                {bible.facts.length} 事 · {bible.foreshadows.length} 伏
              </span>
            </>
          ) : null
        }
      />

      {query.isError ? (
        <div className="bible__error">
        <ErrorNote error={query.error} title="故事设定暂时无法加载" />
        </div>
      ) : query.isPending ? (
        <div className="bible__loading">
          <Skeleton lines={3} />
          <Skeleton lines={6} />
          <Skeleton lines={8} />
        </div>
      ) : bible ? (
        <div className="bible__spread">
          <aside className="bible__rail" aria-label="板块辑签">
            <p className="bible__rail-title">CANON SPREAD</p>
            {SECTION_TABS.map((tab, index) => {
              const count = countForSection(bible, tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="bible__tab"
                  data-active={activeSection === tab.id ? "true" : undefined}
                  aria-pressed={activeSection === tab.id}
                  aria-label={`查看${tab.name}`}
                  onClick={() => setActiveSection(tab.id)}
                >
                  <span className="bible__tab-short" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="bible__tab-name">{tab.name}</span>
                  <span className="bible__tab-count">{count}</span>
                </button>
              );
            })}
          </aside>

          <div className="bible__main">
            <article
              className="bible__active-spread"
              aria-label={`${SECTION_TABS.find((tab) => tab.id === activeSection)?.name ?? "正典"}阅读与编辑`}
            >
              <div className="bible__reader">
                <ActiveSection id={activeSection} bible={bible} />
              </div>
              <aside className="bible__editor">
                <BibleEditor
                  key={activeSection}
                  projectId={projectId}
                  bible={bible}
                  section={activeSection}
                />
                <CanonCandidatePanel
                  projectId={projectId}
                  spread={activeSection}
                />
              </aside>
            </article>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function bibleSection(value: string | null): BibleSectionId {
  return SECTION_TABS.some((section) => section.id === value)
    ? (value as BibleSectionId)
    : "intent";
}

function countForSection(bible: StoryBible, id: BibleSectionId): number {
  switch (id) {
    case "intent":
      return bible.intent ? 1 : 0;
    case "outline":
      return bible.outline.length;
    case "entities":
      return bible.entities.length;
    case "facts":
      return bible.facts.length;
    case "relations":
      return bible.relationships.length;
    case "timeline":
      return bible.timeline.length;
    case "foreshadows":
      return bible.foreshadows.length;
    default:
      return 0;
  }
}

function ActiveSection({
  id,
  bible,
}: {
  id: BibleSectionId;
  bible: StoryBible;
}) {
  switch (id) {
    case "intent":
      return <IntentSection bible={bible} />;
    case "outline":
      return <OutlineSection bible={bible} />;
    case "entities":
      return <EntitySection bible={bible} />;
    case "facts":
      return <FactSection bible={bible} />;
    case "relations":
      return <RelationSection bible={bible} />;
    case "timeline":
      return <TimelineSection bible={bible} />;
    case "foreshadows":
      return <ForeshadowSection bible={bible} />;
  }
}

/* ---- 意图：首语 + 主题带 + 锁栏 ------------------------------------------ */

function IntentSection({ bible }: { bible: StoryBible }) {
  const intent = bible.intent;
  return (
    <section
      className="bible__section"
      id="bible-intent"
      aria-label="作者意图"
    >
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 01
        </span>
        <h2 className="bible__section-title">作者意图</h2>
        <span className="bible__section-en">INTENT</span>
        {intent?.currentFocus ? (
          <span className="bible__section-sub">
            当前焦点：{intent.currentFocus}
          </span>
        ) : null}
      </header>
      <div className="bible__section-body">
        {intent?.promise ? (
          <p className="bible__intent-promise">{intent.promise}</p>
        ) : (
          <p className="bible__hint">尚未落笔首语。意图是这部书最远的一盏灯。</p>
        )}
        {intent ? (
          <>
            <div className="bible__intent-grid">
              {intent.tone ? (
                <div className="bible__intent-kv">
                  <span className="bible__intent-key">TONE 语气</span>
                  <span className="bible__intent-val">{intent.tone}</span>
                </div>
              ) : null}
              {intent.audience ? (
                <div className="bible__intent-kv">
                  <span className="bible__intent-key">AUDIENCE 面向</span>
                  <span className="bible__intent-val">{intent.audience}</span>
                </div>
              ) : null}
              {intent.endingDirection ? (
                <div className="bible__intent-kv">
                  <span className="bible__intent-key">ENDING 终向</span>
                  <span className="bible__intent-val">
                    {intent.endingDirection}
                  </span>
                </div>
              ) : null}
            </div>
            {intent.themes.length ? (
              <div className="bible__intent-kv">
                <span className="bible__intent-key">THEMES 主题</span>
                <div className="bible__intent-bands">
                  {intent.themes.map((theme) => (
                    <span key={theme} className="bible__band">
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {intent.boundaries.length ? (
              <div className="bible__intent-kv">
                <span className="bible__intent-key">BOUNDARIES 不写边界</span>
                <div className="bible__intent-bands">
                  {intent.boundaries.map((boundary) => (
                    <span key={boundary} className="bible__band">
                      {boundary}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {intent.lockedFields.length ? (
              <div className="bible__intent-locked">
                {intent.lockedFields.map((field) => (
                  <span key={field} className="bible__lock">
                    已锁 · {field}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <footer className="bible__foot">
        <span>意图是最高不可違的正典，先意图、后修订。</span>
        <span aria-hidden="true">——叙事回归线</span>
      </footer>
    </section>
  );
}

/* ---- 大纲 ---------------------------------------------------------------- */

function OutlineSection({ bible }: { bible: StoryBible }) {
  const nodes = useMemo(
    () => [...bible.outline].sort((a, b) => (a.path < b.path ? -1 : 1)),
    [bible.outline],
  );
  return (
    <section className="bible__section" id="bible-outline" aria-label="大纲纲目">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 02
        </span>
        <h2 className="bible__section-title">大纲纲目</h2>
        <span className="bible__section-en">OUTLINE</span>
        <span className="bible__section-sub">{nodes.length} 节</span>
      </header>
      <div className="bible__section-body bible__section-body--fill">
        {nodes.length === 0 ? (
          <p className="bible__hint bible__hint--inset">
            还没有节点；书脊从第一章开始长出。
          </p>
        ) : (
          <div className="bible__outline">
            {nodes.map((node) => (
              <div
                key={node.id}
                className="bible__outline-row"
                data-status={node.status}
                style={{ paddingLeft: `${1.1 + node.depth * 1.4}rem` }}
              >
                <span className="bible__outline-kind">
                  {outlineKindLabel(node.kind)}
                </span>
                <div className="bible__outline-title">
                  <span className="bible__outline-name">{node.title}</span>
                  {node.summary ? (
                    <span className="bible__outline-summary">
                      {node.summary}
                    </span>
                  ) : null}
                  {(node.goal ?? node.conflict) !== null ? (
                    <span className="bible__outline-shows-kicker">
                      {node.goal ? (
                        <span className="bible__outline-mini">
                          目标：{node.goal}
                        </span>
                      ) : null}
                      {node.conflict ? (
                        <span className="bible__outline-mini">
                          冲突：{node.conflict}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {node.status === "committed" ? (
                  <span className="bible__outline-tag">已定稿</span>
                ) : (
                  <span
                    className="bible__outline-status"
                    data-status={node.status}
                  >
                    {outlineStatusLabel(node.status)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---- 实体 ---------------------------------------------------------------- */

function EntitySection({ bible }: { bible: StoryBible }) {
  return (
    <section className="bible__section" id="bible-entities" aria-label="实体册">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 03
        </span>
        <h2 className="bible__section-title">实体册</h2>
        <span className="bible__section-en">CANON ENTITIES</span>
        <span className="bible__section-sub">{bible.entities.length} 体</span>
      </header>
      <div className="bible__section-body">
        {bible.entities.length === 0 ? (
          <p className="bible__hint">还没有实体登场。</p>
        ) : (
          <div className="bible__cards">
            {bible.entities.map((entity) => (
              <article key={entity.id} className="bible__card">
                <span className="bible__card-kind">
                  {entityTypeLabel(entity.type)}
                </span>
                <span className="bible__card-name">{entity.name}</span>
                {entity.description ? (
                  <span className="bible__card-desc">{entity.description}</span>
                ) : null}
                {entity.aliases.length > 0 ? (
                  <div className="bible__card-tags">
                    {entity.aliases.map((alias) => (
                      <span key={alias} className="bible__card-chip">
                        {alias}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---- 正典：事实清单 ------------------------------------------------------- */

function FactSection({ bible }: { bible: StoryBible }) {
  const facts = useMemo(() => {
    const byId = new Map(bible.entities.map((entity) => [entity.id, entity]));
    return bible.facts.map((fact) => ({
      fact,
      subject: byId.get(fact.subjectId)?.name ?? fact.subjectId,
      object: byId.get(fact.objectEntityId ?? "")?.name ?? null,
    }));
  }, [bible.entities, bible.facts]);
  return (
    <section className="bible__section" id="bible-facts" aria-label="正典事实">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 04
        </span>
        <h2 className="bible__section-title">正典事实</h2>
        <span className="bible__section-en">FACTS</span>
        <span className="bible__section-sub">{facts.length} 事</span>
      </header>
      <div className="bible__section-body bible__section-body--fill">
        {facts.length === 0 ? (
          <p className="bible__hint bible__hint--inset">
            尚无事实签订；一切照旧尚未成为事实。
          </p>
        ) : (
          <div className="bible__facts">
            {facts.map(({ fact, subject, object }) => (
              <div key={fact.id} className="bible__facts-row">
                <span
                  className="bible__facts-authority"
                  data-a={fact.authority}
                >
                  {factAuthorityLabel(fact.authority)}
                </span>
                <span className="bible__facts-subject">{subject}</span>
                <span className="bible__facts-pred">{fact.predicate}</span>
                <span
                  className="bible__facts-obj"
                  data-locked={fact.authority === "locked"}
                >
                  {object ?? jsonValueOf(fact.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function jsonValueOf(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "…";
  }
}

/* ---- 关系 ---------------------------------------------------------------- */

function RelationSection({ bible }: { bible: StoryBible }) {
  const entities = useMemo(
    () => new Map(bible.entities.map((entity) => [entity.id, entity.name])),
    [bible.entities],
  );
  return (
    <section className="bible__section" id="bible-relations" aria-label="关系谱">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 05
        </span>
        <h2 className="bible__section-title">关系谱</h2>
        <span className="bible__section-en">RELATIONS</span>
        <span className="bible__section-sub">
          {bible.relationships.length} 条
        </span>
      </header>
      <div className="bible__section-body bible__section-body--fill">
        {bible.relationships.length === 0 ? (
          <p className="bible__hint bible__hint--inset">
            还没有关系事件被写入。
          </p>
        ) : (
          <div className="bible__ledger">
            {bible.relationships.map((rel) => (
              <div key={rel.id} className="bible__ledger-row">
                <span className="bible__ledger-meta">
                  {rel.storyTime ?? rel.createdAt.slice(0, 10)}
                </span>
                <div className="bible__ledger-main">
                  <span className="bible__ledger-line">
                    {entities.get(rel.fromEntityId) ?? rel.fromEntityId} ·{" "}
                    {rel.relation} ·{" "}
                    {entities.get(rel.toEntityId) ?? rel.toEntityId}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---- 时间线 -------------------------------------------------------------- */

function TimelineSection({ bible }: { bible: StoryBible }) {
  return (
    <section className="bible__section" id="bible-timeline" aria-label="时间线">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 06
        </span>
        <h2 className="bible__section-title">时间线</h2>
        <span className="bible__section-en">TIMELINE</span>
        <span className="bible__section-sub">{bible.timeline.length} 条</span>
      </header>
      <div className="bible__section-body">
        {bible.timeline.length === 0 ? (
          <p className="bible__hint">故事还没有落笔到时间的刻度上。</p>
        ) : (
          bible.timeline.map((event) => (
            <div key={event.id}>
              <p className="bible__facts-line">
                <strong>{event.title}</strong>
                {event.storyTimeStart ? `（${event.storyTimeStart}）` : ""}
              </p>
              {event.description ? (
                <p className="bible__blockquote">{event.description}</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ---- 伏笔 ---------------------------------------------------------------- */

function ForeshadowSection({ bible }: { bible: StoryBible }) {
  return (
    <section className="bible__section" id="bible-foreshadows" aria-label="伏笔谱">
      <header className="bible__section-head">
        <span className="bible__section-no mono" aria-hidden="true">
          § 07
        </span>
        <h2 className="bible__section-title">伏笔谱</h2>
        <span className="bible__section-en">FORESHADOW</span>
        <span className="bible__section-sub">
          {bible.foreshadows.length} 伏
        </span>
      </header>
      <div className="bible__section-body">
        {bible.foreshadows.length === 0 ? (
          <p className="bible__hint">尚未在章节里落埋。</p>
        ) : (
          <div className="bible__foreshadows">
            {bible.foreshadows.map((foreshadow) => (
              <article
                key={foreshadow.id}
                className="bible__foreshadow-card"
                data-s={foreshadow.status}
              >
                <div className="bible__foreshadow-state">
                  <span className="bible__foreshadow-stat">
                    {foreshadowStatusLabel(foreshadow.status)}
                  </span>
                  <span className="bible__foreshadow-pin">
                    {"★".repeat(foreshadow.importance)}
                  </span>
                </div>
                <p className="bible__foreshadow-title">{foreshadow.title}</p>
                <p className="bible__foreshadow-desc">
                  {foreshadow.description}
                </p>
                <p className="bible__foreshadow-meta">
                  证据 {foreshadow.evidenceNodeIds.length} 踏 · 更新于{" "}
                  {foreshadow.updatedAt.slice(0, 10)}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
