import type { RouteApp } from "@narrative-lantern/services";
import {
  DecidePredictionRequestSchema,
  DryRunRequestSchema,
  DryRunResultSchema,
  GeneratePredictionsRequestSchema,
  NarrativeMemorySchema,
  PlotPredictionSchema,
  RetrievalHitSchema,
  RetrievalSearchRequestSchema,
} from "@narrative-lantern/contracts";
import {
  SqliteLongNovelRepository,
  SqliteRetrievalRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";
import { z } from "zod";

const ProjectParamsSchema = z.object({ projectId: z.string().min(1) });
const PredictionParamsSchema = ProjectParamsSchema.extend({
  predictionId: z.string().min(1),
});
const MemoryQuerySchema = z.object({
  includeStale: z.coerce.boolean().default(false),
});

export function registerLongNovelRoutes(
  app: RouteApp,
  database: NarrativeDatabase,
): void {
  const retrieval = new SqliteRetrievalRepository(database);
  const longNovel = new SqliteLongNovelRepository(database);

  app.route(
    "POST",
    "/api/projects/:projectId/retrieval/search",
    async (request) => {
      const { projectId } = ProjectParamsSchema.parse(request.params);
      const input = RetrievalSearchRequestSchema.parse(request.body);
      return retrieval
        .search(projectId, input.query, input)
        .map((hit) => RetrievalHitSchema.parse(hit));
    },
  );

  app.route("GET", "/api/projects/:projectId/memories", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    const input = MemoryQuerySchema.parse(request.query);
    return longNovel
      .listMemories(projectId, input)
      .map((memory) => NarrativeMemorySchema.parse(memory));
  });

  app.route(
    "POST",
    "/api/projects/:projectId/memories/rebuild",
    async (request) => {
      const { projectId } = ProjectParamsSchema.parse(request.params);
      return longNovel
        .rebuildMemories(projectId, new Date().toISOString())
        .map((memory) => NarrativeMemorySchema.parse(memory));
    },
  );

  app.route(
    "POST",
    "/api/projects/:projectId/memories/sleep",
    async (request) => {
      const { projectId } = ProjectParamsSchema.parse(request.params);
      const memory = longNovel.consolidateSleep(
        projectId,
        new Date().toISOString(),
      );
      return memory ? NarrativeMemorySchema.parse(memory) : null;
    },
  );

  app.route("GET", "/api/projects/:projectId/predictions", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    return longNovel
      .listPredictions(projectId)
      .map((prediction) => PlotPredictionSchema.parse(prediction));
  });

  app.route("POST", "/api/projects/:projectId/predictions", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    const input = GeneratePredictionsRequestSchema.parse(request.body);
    return longNovel
      .generatePredictions(projectId, input, new Date().toISOString())
      .map((prediction) => PlotPredictionSchema.parse(prediction));
  });

  app.route(
    "PUT",
    "/api/projects/:projectId/predictions/:predictionId",
    async (request) => {
      const { projectId, predictionId } = PredictionParamsSchema.parse(
        request.params,
      );
      const input = DecidePredictionRequestSchema.parse(request.body);
      return PlotPredictionSchema.parse(
        longNovel.decidePrediction(
          projectId,
          predictionId,
          input.status,
          new Date().toISOString(),
        ),
      );
    },
  );

  app.route("POST", "/api/projects/:projectId/dry-run", async (request) => {
    const { projectId } = ProjectParamsSchema.parse(request.params);
    const input = DryRunRequestSchema.parse(request.body);
    return DryRunResultSchema.parse(longNovel.dryRun(projectId, input.change));
  });
}
