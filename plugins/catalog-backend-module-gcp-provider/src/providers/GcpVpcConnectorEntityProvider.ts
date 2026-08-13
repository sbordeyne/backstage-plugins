import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, vpcaccess_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Serverless VPC Access connectors.
 *
 * A connector is how a Cloud Run service or a Cloud Function reaches anything with a private
 * address, so it is the missing hop between the serverless entities and the VPC ones.
 */
export class GcpVpcConnectorEntityProvider extends GcpRestEntityProvider<vpcaccess_v1.Vpcaccess> {
  getProviderName(): string {
    return 'gcp-vpcconnectors';
  }

  getProviderConfigKey(): string {
    return 'vpcconnectors';
  }

  getClient(): vpcaccess_v1.Vpcaccess {
    return google.vpcaccess({ version: 'v1', auth: this.googleAuth });
  }

  private connectorToResource(connector: vpcaccess_v1.Schema$Connector, project: string): DeferredEntity | undefined {
    const connectorId = lastSegment(connector.name);
    if (!connectorId) {
      return undefined;
    }
    const region = segmentAfter(connector.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const subnet = connector.subnet?.name;

    return this.toEntity(
      {
        name: connectorId,
        projectId: project,
        type: 'vpc-connector',
        region,
        selfLink: apiSelfLink('vpcaccess.googleapis.com', 'v1', connector.name),
        summary: `VPC connector in ${region ?? 'an unreported region'} on ${
          connector.ipCidrRange ?? subnet ?? 'an unreported range'
        }, ${(connector.state ?? 'unknown state').toLocaleLowerCase()}`,
        consolePath: `networking/connectors/details/${region}/${connectorId}`,
        tagValues: [connector.state, connector.machineType],
        annotations: {
          ...(connector.state ? { [ANNOTATION_GCP_STATUS]: connector.state } : {}),
          ...(connector.ipCidrRange ? { 'cloud.google.com/ip-cidr-range': connector.ipCidrRange } : {}),
        },
      },
      {
        attachedTo: [
          ...(connector.network ? [this.vpcRef(connector.network, project)] : []),
          // The subnet is named bare rather than as a URL, and belongs to the connector's region.
          ...(subnet && region
            ? [
                this.resourceRef('subnets', {
                  projectId: project,
                  type: 'subnetwork',
                  provider: 'gcp-subnets',
                  region,
                  name: `${subnet}-${region}`,
                }),
              ]
            : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const connectors = await this.listAll<vpcaccess_v1.Schema$Connector>(async pageToken => {
        const { data } = await this.client.projects.locations.connectors.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.connectors, nextPageToken: data.nextPageToken };
      });
      return connectors
        .map(connector => this.connectorToResource(connector, project))
        .filter(entity => entity !== undefined);
    });
  }
}
