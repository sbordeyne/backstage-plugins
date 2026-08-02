import type { HttpAuthService, SchedulerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import type { catalogServiceRef } from '@backstage/plugin-catalog-node';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod';

import type { BrunoStore } from './database/BrunoStore';
import { decodeResultCursor, decodeRunCursor } from './database/cursors';

export const SYNC_TASK_ID = 'bruno-gcs-sync';

const listRunsQuery = z.object({
  // A query param, not a path segment: entity refs contain ':' and '/', and an
  // encoded slash inside a path segment gets normalized by some ingresses.
  entityRef: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const listResultsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  status: z.enum(['pass', 'error']).optional(),
  iteration: z.coerce.number().int().min(0).optional(),
});

export interface RouterOptions {
  httpAuth: HttpAuthService;
  catalog: typeof catalogServiceRef.T;
  store: BrunoStore;
  scheduler: SchedulerService;
  syncEnabled: boolean;
}

export async function createRouter(options: RouterOptions): Promise<express.Router> {
  const { httpAuth, catalog, store, scheduler, syncEnabled } = options;
  const router = Router();
  router.use(express.json());

  /**
   * Reading straight from our own tables would bypass the catalog's permission
   * model, so visibility is re-derived from the owning entity on every request.
   */
  async function assertEntityVisible(request: express.Request, entityRef: string): Promise<void> {
    const credentials = await httpAuth.credentials(request, { allow: ['user'] });
    const entity = await catalog.getEntityByRef(entityRef, { credentials });
    if (!entity) {
      throw new NotFoundError(`No entity found for ref '${entityRef}'`);
    }
  }

  router.get('/v1/runs', async (req, res) => {
    const query = parse(listRunsQuery, req.query);
    await assertEntityVisible(req, query.entityRef);

    res.json(
      await store.listRuns({
        entityRef: query.entityRef,
        limit: query.limit,
        cursor: query.cursor ? decodeRunCursor(query.cursor) : undefined,
      }),
    );
  });

  router.get('/v1/runs/:runId', async (req, res) => {
    const run = await store.getRun(req.params.runId);
    if (!run) {
      throw new NotFoundError(`No Bruno run found with id '${req.params.runId}'`);
    }
    await assertEntityVisible(req, run.entityRef);
    res.json(run);
  });

  router.get('/v1/runs/:runId/results', async (req, res) => {
    const query = parse(listResultsQuery, req.query);
    const run = await store.getRun(req.params.runId);
    if (!run) {
      throw new NotFoundError(`No Bruno run found with id '${req.params.runId}'`);
    }
    await assertEntityVisible(req, run.entityRef);

    res.json(
      await store.listResults({
        runId: run.id,
        limit: query.limit,
        afterSeq: query.cursor ? decodeResultCursor(query.cursor) : undefined,
        status: query.status,
        iterationIndex: query.iteration,
      }),
    );
  });

  router.get('/v1/results/:resultId', async (req, res) => {
    const found = await store.getResultDetail(req.params.resultId);
    if (!found) {
      throw new NotFoundError(`No Bruno result found with id '${req.params.resultId}'`);
    }
    await assertEntityVisible(req, found.entityRef);

    // A stored result never changes, so it can be cached hard.
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.json(found.detail);
  });

  router.post('/v1/sync', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    if (!syncEnabled) {
      // Otherwise this surfaces as a bare "Task bruno-gcs-sync does not exist".
      throw new NotFoundError('Bruno sync is disabled; set bruno.sync.enabled to true to schedule it');
    }
    await scheduler.triggerTask(SYNC_TASK_ID);
    res.status(202).json({ triggered: true });
  });

  return router;
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InputError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return result.data;
}
