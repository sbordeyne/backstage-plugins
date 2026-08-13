import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { analyticshub_v1, bigqueryreservation_v1, dataflow_v1b3, dataplex_v1, datastream_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Datastream streams: change data capture out of a database and into a destination. */
export class GcpDatastreamEntityProvider extends GcpRestEntityProvider<datastream_v1.Datastream> {
  getProviderName(): string {
    return 'gcp-datastream';
  }

  getProviderConfigKey(): string {
    return 'datastream';
  }

  getClient(): datastream_v1.Datastream {
    return google.datastream({ version: 'v1', auth: this.googleAuth });
  }

  private streamToResource(stream: datastream_v1.Schema$Stream, project: string): DeferredEntity | undefined {
    const streamId = lastSegment(stream.name);
    if (!streamId) {
      return undefined;
    }
    const region = segmentAfter(stream.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const source = lastSegment(stream.sourceConfig?.sourceConnectionProfile);
    const destination = lastSegment(stream.destinationConfig?.destinationConnectionProfile);

    return this.toEntity({
      name: streamId,
      projectId: project,
      type: 'datastream-stream',
      region,
      title: stream.displayName,
      selfLink: apiSelfLink('datastream.googleapis.com', 'v1', stream.name),
      labels: stream.labels,
      summary: `Streams ${source || 'an unreported source'} into ${destination || 'an unreported destination'}, ${(
        stream.state ?? 'unknown state'
      ).toLocaleLowerCase()}`,
      consolePath: `datastream/streams/locations/${region}/instances/${streamId}`,
      tagValues: [stream.state],
      annotations: {
        ...(stream.state ? { [ANNOTATION_GCP_STATUS]: stream.state } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const streams = await this.listAll<datastream_v1.Schema$Stream>(async pageToken => {
        const { data } = await this.client.projects.locations.streams.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.streams, nextPageToken: data.nextPageToken };
      });
      return streams.map(stream => this.streamToResource(stream, project)).filter(entity => entity !== undefined);
    });
  }
}

/** Dataplex lakes: the governance layer over buckets and datasets. */
export class GcpDataplexEntityProvider extends GcpRestEntityProvider<dataplex_v1.Dataplex> {
  getProviderName(): string {
    return 'gcp-dataplex';
  }

  getProviderConfigKey(): string {
    return 'dataplex';
  }

  getClient(): dataplex_v1.Dataplex {
    return google.dataplex({ version: 'v1', auth: this.googleAuth });
  }

  private lakeToResource(
    lake: dataplex_v1.Schema$GoogleCloudDataplexV1Lake,
    project: string,
  ): DeferredEntity | undefined {
    const lakeId = lastSegment(lake.name);
    if (!lakeId) {
      return undefined;
    }
    const region = segmentAfter(lake.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }

    return this.toEntity({
      name: lakeId,
      projectId: project,
      type: 'dataplex-lake',
      region,
      title: lake.displayName,
      description: lake.description,
      selfLink: apiSelfLink('dataplex.googleapis.com', 'v1', lake.name),
      labels: lake.labels,
      summary: `Dataplex lake in ${region ?? 'an unreported region'}, ${(
        lake.state ?? 'unknown state'
      ).toLocaleLowerCase()}`,
      consolePath: `dataplex/lakes/${lakeId}?project=${project}`,
      tagValues: [lake.state],
      annotations: {
        ...(lake.state ? { [ANNOTATION_GCP_STATUS]: lake.state } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const lakes = await this.listAll<dataplex_v1.Schema$GoogleCloudDataplexV1Lake>(async pageToken => {
        const { data } = await this.client.projects.locations.lakes.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.lakes, nextPageToken: data.nextPageToken };
      });
      return lakes.map(lake => this.lakeToResource(lake, project)).filter(entity => entity !== undefined);
    });
  }
}

/** Analytics Hub data exchanges and the listings published in them. */
export class GcpAnalyticsHubEntityProvider extends GcpRestEntityProvider<analyticshub_v1.Analyticshub> {
  getProviderName(): string {
    return 'gcp-analyticshub';
  }

  getProviderConfigKey(): string {
    return 'analyticshub';
  }

  getClient(): analyticshub_v1.Analyticshub {
    return google.analyticshub({ version: 'v1', auth: this.googleAuth });
  }

  private async exchangeToResources(
    exchange: analyticshub_v1.Schema$DataExchange,
    project: string,
  ): Promise<DeferredEntity[]> {
    const exchangeId = lastSegment(exchange.name);
    if (!exchangeId) {
      return [];
    }
    const region = segmentAfter(exchange.name, 'locations');
    if (!this.includesLocation(region)) {
      return [];
    }

    const exchangeRef = this.ownRef({
      projectId: project,
      type: 'analytics-hub-exchange',
      provider: this.getProviderName(),
      region,
      name: exchangeId,
    });

    const listings = await this.listAll<analyticshub_v1.Schema$Listing>(async pageToken => {
      const { data } = await this.client.projects.locations.dataExchanges.listings.list({
        parent: exchange.name!,
        pageToken,
      });
      return { items: data.listings, nextPageToken: data.nextPageToken };
    });

    const exchangeEntity = this.toEntity({
      name: exchangeId,
      projectId: project,
      type: 'analytics-hub-exchange',
      region,
      title: exchange.displayName,
      description: exchange.description,
      selfLink: apiSelfLink('analyticshub.googleapis.com', 'v1', exchange.name),
      summary: `Data exchange publishing ${exchange.listingCount ?? listings.length} listing(s)`,
      consolePath: `bigquery/analytics-hub/exchanges/${region}/${exchangeId}`,
    });

    const listingEntities = listings
      .map(listing => {
        const listingId = lastSegment(listing.name);
        if (!listingId) {
          return undefined;
        }
        // The dataset behind a listing is what the graph actually wants.
        const dataset = lastSegment(listing.bigqueryDataset?.dataset);
        return this.toEntity(
          {
            name: `${exchangeId}-${listingId}`,
            projectId: project,
            type: 'analytics-hub-listing',
            region,
            title: listing.displayName ?? listingId,
            description: listing.description,
            selfLink: apiSelfLink('analyticshub.googleapis.com', 'v1', listing.name),
            summary: `Listing of ${dataset || 'an unreported dataset'} in exchange ${exchangeId}`,
            consolePath: `bigquery/analytics-hub/exchanges/${region}/${exchangeId}/listings/${listingId}`,
            tagValues: [listing.categories?.join(',')],
          },
          {
            dependsOn: [
              exchangeRef,
              ...(dataset
                ? [
                    this.resourceRef('bigquery', {
                      projectId: segmentAfter(listing.bigqueryDataset?.dataset, 'projects') ?? project,
                      type: 'bigquery-dataset',
                      provider: 'gcp-bigquery',
                      name: dataset,
                    }),
                  ]
                : []),
            ],
          },
        );
      })
      .filter(entity => entity !== undefined);

    return [exchangeEntity, ...listingEntities];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const exchanges = await this.listAll<analyticshub_v1.Schema$DataExchange>(async pageToken => {
        const { data } = await this.client.projects.locations.dataExchanges.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.dataExchanges, nextPageToken: data.nextPageToken };
      });
      const entities = await Promise.all(
        exchanges.filter(exchange => exchange.name).map(exchange => this.exchangeToResources(exchange, project)),
      );
      return entities.flat();
    });
  }
}

/** BigQuery reservations: the slot capacity queries are billed against. */
export class GcpBigQueryReservationEntityProvider extends GcpRestEntityProvider<bigqueryreservation_v1.Bigqueryreservation> {
  getProviderName(): string {
    return 'gcp-bqreservations';
  }

  getProviderConfigKey(): string {
    return 'bqreservations';
  }

  getClient(): bigqueryreservation_v1.Bigqueryreservation {
    return google.bigqueryreservation({ version: 'v1', auth: this.googleAuth });
  }

  private reservationToResource(
    reservation: bigqueryreservation_v1.Schema$Reservation,
    project: string,
  ): DeferredEntity | undefined {
    const reservationId = lastSegment(reservation.name);
    if (!reservationId) {
      return undefined;
    }
    const region = segmentAfter(reservation.name, 'locations');

    return this.toEntity({
      name: reservationId,
      projectId: project,
      type: 'bigquery-reservation',
      region,
      selfLink: apiSelfLink('bigqueryreservation.googleapis.com', 'v1', reservation.name),
      summary: `${reservation.slotCapacity ?? 0} slot(s) of ${reservation.edition ?? 'unreported'} capacity in ${
        region ?? 'an unreported location'
      }`,
      consolePath: `bigquery/admin/reservations/${region}/${reservationId}`,
      tagValues: [reservation.edition, reservation.ignoreIdleSlots ? 'no-idle-slots' : 'idle-slots'],
      annotations: {
        'cloud.google.com/slot-capacity': String(reservation.slotCapacity ?? 0),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const reservations = await this.listAll<bigqueryreservation_v1.Schema$Reservation>(async pageToken => {
        const { data } = await this.client.projects.locations.reservations.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.reservations, nextPageToken: data.nextPageToken };
      });
      return reservations
        .map(reservation => this.reservationToResource(reservation, project))
        .filter(entity => entity !== undefined);
    });
  }
}

/**
 * Dataflow jobs.
 *
 * Off unless configured, and worth leaving off for batch estates: a job is one execution, so a
 * pipeline running hourly produces a new entity every hour. `states` narrows it to the jobs that
 * are actually running.
 */
export class GcpDataflowEntityProvider extends GcpRestEntityProvider<dataflow_v1b3.Dataflow> {
  getProviderName(): string {
    return 'gcp-dataflow';
  }

  getProviderConfigKey(): string {
    return 'dataflow';
  }

  getClient(): dataflow_v1b3.Dataflow {
    return google.dataflow({ version: 'v1b3', auth: this.googleAuth });
  }

  /** Job states to ingest. Defaults to the running ones, which is the useful subset. */
  private get states(): string[] {
    return (this.config.getOptionalStringArray('states') ?? ['JOB_STATE_RUNNING']).map(state =>
      state.toLocaleUpperCase(),
    );
  }

  private jobToResource(job: dataflow_v1b3.Schema$Job, project: string): DeferredEntity | undefined {
    if (!job.name || !job.id) {
      return undefined;
    }
    if (!this.states.includes((job.currentState ?? '').toLocaleUpperCase())) {
      return undefined;
    }
    const region = job.location ?? undefined;

    return this.toEntity({
      name: job.name,
      projectId: project,
      type: 'dataflow-job',
      region,
      selfLink: `https://dataflow.googleapis.com/v1b3/projects/${project}/locations/${region}/jobs/${job.id}`,
      labels: job.labels,
      summary: `${(job.type ?? 'JOB_TYPE_BATCH').replace('JOB_TYPE_', '').toLocaleLowerCase()} Dataflow job in ${
        region ?? 'an unreported region'
      }, ${(job.currentState ?? '').replace('JOB_STATE_', '').toLocaleLowerCase()}`,
      consolePath: `dataflow/jobs/${region}/${job.id}`,
      logFilter: `resource.type="dataflow_step" resource.labels.job_id="${job.id}"`,
      tagValues: [job.type, job.currentState],
      annotations: {
        ...(job.currentState ? { [ANNOTATION_GCP_STATUS]: job.currentState } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // The aggregated listing covers every region in one call series.
      const jobs = await this.listAll<dataflow_v1b3.Schema$Job>(async pageToken => {
        const { data } = await this.client.projects.jobs.aggregated({ projectId: project, pageToken });
        return { items: data.jobs, nextPageToken: data.nextPageToken };
      });
      return jobs.map(job => this.jobToResource(job, project)).filter(entity => entity !== undefined);
    });
  }
}
