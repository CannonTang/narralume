import {
  createOutlineNode,
  createProject,
  type Project,
} from "@narralume/domain";
import {
  SqliteProjectRepository,
  SqliteStoryRepository,
  type NarrativeDatabase,
} from "@narralume/persistence";

export interface ProjectBootstrapInput {
  projectId: string;
  rootOutlineNodeId: string;
  title: string;
  subtitle: string | null;
  premise: string | null;
  language: string;
  now: string;
}

export function bootstrapProject(
  database: NarrativeDatabase,
  input: ProjectBootstrapInput,
): Project {
  const projects = new SqliteProjectRepository(database);
  const story = new SqliteStoryRepository(database);
  const project = createProject({
    id: input.projectId,
    now: input.now,
    title: input.title,
    language: input.language,
    subtitle: input.subtitle,
    premise: input.premise,
  });
  return database.transaction(() => {
    projects.insert(project);
    story.insertOutlineNode(
      createOutlineNode({
        id: input.rootOutlineNodeId,
        projectId: project.id,
        parent: null,
        kind: "book",
        ordinal: 0,
        title: project.title,
        summary: project.premise,
        now: input.now,
      }),
    );
    story.upsertAuthorIntent(emptyIntent(project.id, input.now));
    return project;
  });
}

function emptyIntent(projectId: string, now: string) {
  return {
    projectId,
    promise: null,
    themes: [],
    audience: null,
    tone: null,
    boundaries: [],
    endingDirection: null,
    currentFocus: null,
    lockedFields: [],
    updatedAt: now,
  };
}
