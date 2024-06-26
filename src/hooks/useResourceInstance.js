import { useQuery } from "@tanstack/react-query";
import { getResourceInstanceDetails } from "../api/resourceInstance";
import processClusterPorts from "../utils/processClusterPorts";

export default function useResourceInstance(
  serviceProviderId,
  serviceKey,
  serviceAPIVersion,
  serviceEnvironmentKey,
  serviceModelKey,
  productTierKey,
  resourceKey,
  resourceInstanceId,
  resourceId,
  subscriptionId
) {
  const isQueryEnabled = Boolean(
    serviceProviderId &&
      serviceKey &&
      serviceAPIVersion &&
      serviceEnvironmentKey &&
      serviceModelKey &&
      productTierKey &&
      resourceKey &&
      resourceInstanceId &&
      subscriptionId
  );

  const resourceInstanceQuery = useQuery(
    [
      "resource-instance",
      serviceProviderId,
      serviceKey,
      serviceAPIVersion,
      serviceEnvironmentKey,
      serviceModelKey,
      productTierKey,
      resourceKey,
      resourceInstanceId,
      subscriptionId,
    ],
    () => {
      return getResourceInstanceDetails(
        serviceProviderId,
        serviceKey,
        serviceAPIVersion,
        serviceEnvironmentKey,
        serviceModelKey,
        productTierKey,
        resourceKey,
        resourceInstanceId,
        subscriptionId
      );
    },
    {
      enabled: isQueryEnabled,
      retry: false,
      refetchInterval: 60000,
      refetchOnMount: true,
      refetchOnWindowFocus: false,

      select: (response) => {
        const data = response.data;

        let isLogsEnabled = false;
        let isMetricsEnabled = false;
        let metricsSocketURL = "";
        let logsSocketURL = "";

        const topologyDetails = data?.detailedNetworkTopology?.[resourceId];
        const nodeEndpointsList = [];
        const availabilityZonesList = [];
        const nodes = [];
        const globalEndpoints = {};

        if (topologyDetails) {
          globalEndpoints.primary = {
            resourceName: topologyDetails.resourceName,
            endpoint: topologyDetails.clusterEndpoint
              ? topologyDetails.clusterEndpoint
              : "",
          };
          globalEndpoints.others = [];
        }

        const productTierFeatures = data?.productTierFeatures;

        if (productTierFeatures?.LOGS?.enabled) {
          isLogsEnabled = true;
        }

        if (productTierFeatures?.METRICS?.enabled) {
          isMetricsEnabled = true;
        }

        if (topologyDetails?.nodes) {
          topologyDetails.nodes.forEach((node) => {
            const nodeId = node.id;
            const endpoint = node.endpoint;
            const ports = processClusterPorts(node.ports);
            const availabilityZone = node.availabilityZone;
            const status = node.status;
            const resourceName = topologyDetails.resourceName;
            const resourceKey = topologyDetails.resourceKey;
            const healthStatus = node.healthStatus;
            nodes.push({
              id: nodeId,
              nodeId: nodeId,
              endpoint: endpoint,
              ports: ports,
              availabilityZone: availabilityZone,
              status: status,
              searchString: `${nodeId}${endpoint}${ports}${availabilityZone}${status}`,
              resourceName: resourceName,
              healthStatus: healthStatus,
              resourceKey: resourceKey,
            });

            nodeEndpointsList.push(node.endpoint);
            availabilityZonesList.push(node.availabilityZone);
          });
        }

        const nodeEndpoints = nodeEndpointsList.join(", ");
        const availabilityZones = [...new Set(availabilityZonesList)].join(
          ", "
        );

        let createdAt = data.created_at;
        let modifiedAt = data.last_modified_at;

        const topologyDetailsOtherThanMain = Object.entries(
          data.detailedNetworkTopology ?? {}
        )?.filter(([resourceId, topologyDetails]) => {
          return topologyDetails.main === false;
        });

        topologyDetailsOtherThanMain?.forEach(
          ([resourceId, topologyDetails]) => {
            const { resourceKey } = topologyDetails;
            if (resourceKey === "omnistrateobserv") {
              // Show Both Logs and Metrics if Observability Resource Present
              // isLogsEnabled = true;
              // isMetricsEnabled = true;

              const clusterEndpoint = topologyDetails.clusterEndpoint;
              const [userPass, baseURL] = clusterEndpoint.split("@");
              // console.log("CE", clusterEndpoint);
              if (userPass && baseURL) {
                const [username, password] = userPass.split(":");
                metricsSocketURL = `wss://${baseURL}/metrics?username=${username}&password=${password}`;
                logsSocketURL = `wss://${baseURL}/logs?username=${username}&password=${password}`;
              }

              globalEndpoints.others.push({
                resourceName: topologyDetails.resourceName,
                endpoint: topologyDetails.clusterEndpoint
                  ? topologyDetails.clusterEndpoint
                  : "",
              });
            } else {
              if (topologyDetails.nodes) {
                topologyDetails.nodes.forEach((node) => {
                  const nodeId = node.id;
                  const endpoint = node.endpoint;
                  const ports = processClusterPorts(node.ports);
                  const availabilityZone = node.availabilityZone;
                  const status = node.status;
                  const resourceName = topologyDetails.resourceName;
                  const resourceKey = topologyDetails.resourceKey;
                  nodes.push({
                    id: nodeId,
                    nodeId: nodeId,
                    endpoint: endpoint,
                    ports: ports,
                    availabilityZone: availabilityZone,
                    status: status,
                    searchString: `${nodeId}${endpoint}${ports}${availabilityZone}${status}`,
                    resourceName: resourceName,
                    healthStatus: node.healthStatus,
                    resourceKey,
                  });
                });
              }
              globalEndpoints.others.push({
                resourceName: topologyDetails.resourceName,
                endpoint: topologyDetails.clusterEndpoint
                  ? topologyDetails.clusterEndpoint
                  : "",
              });
            }
          }
        );

        // Initial value already has the main resource. So, if 'main' is true, then don't add any value to the Array

        let clusterPorts;
        if (data?.detailedNetworkTopology) {
          clusterPorts = Object.values(data.detailedNetworkTopology).reduce(
            (accumulator, topologyDetails) => {
              if (topologyDetails.main) return accumulator;
              return [
                ...accumulator,
                {
                  resourceName: topologyDetails?.resourceName,
                  ports: processClusterPorts(topologyDetails?.clusterPorts),
                },
              ];
            },
            [
              {
                resourceName: topologyDetails?.resourceName,
                ports: processClusterPorts(topologyDetails?.clusterPorts),
              },
            ]
          );
        }

        let healthStatusPercent = 0;

        if (nodes?.length > 0) {
          let healthyNodes = nodes?.filter(
            (node) => node?.healthStatus === "HEALTHY"
          );
          healthStatusPercent = (healthyNodes?.length / nodes?.length) * 100;
        } else if (data?.status === "RUNNING" || data?.status === "READY") {
          healthStatusPercent = 100;
        }

        const final = {
          resourceInstanceId: resourceInstanceId,
          resourceKey: topologyDetails?.resourceKey,
          region: data.region,
          cloudProvider: data.cloud_provider,
          status: data.status,
          createdAt: createdAt,
          modifiedAt: modifiedAt,
          networkType: data.network_type,
          connectivity: {
            networkType: _.capitalize(data.network_type),
            clusterEndpoint: topologyDetails?.clusterEndpoint,
            nodeEndpoints: nodeEndpoints,
            ports: clusterPorts,
            availabilityZones: availabilityZones,
            publiclyAccessible: topologyDetails?.publiclyAccessible,
            privateNetworkCIDR: topologyDetails?.privateNetworkCIDR,
            privateNetworkId: topologyDetails?.privateNetworkID,
            globalEndpoints: globalEndpoints,
          },
          nodes: nodes,
          resultParameters: data.result_params,
          isLogsEnabled: isLogsEnabled,
          isMetricsEnabled: isMetricsEnabled,
          metricsSocketURL: metricsSocketURL,
          logsSocketURL: logsSocketURL,
          healthStatusPercent: healthStatusPercent,
          active: data?.active,
        };
        //console.log("Final", final);
        return final;
      },
    }
  );

  return resourceInstanceQuery;
}

// {
//     "r-p8UuvixUZf": {
//         "clusterEndpoint": "r-p8uuvixuzf.instance-x2pwx8edi.ca-central-1.aws.omnistrate.dev",
//         "nodes": [
//             {
//                 "endpoint": "postgres-0.r-p8uuvixuzf.instance-x2pwx8edi.ca-central-1.aws.omnistrate.dev",
//                 "availabilityZone": "ca-central-1a",
//                 "ports": [
//                     5432
//                 ],
//                 "id": "postgres-0",
//                 "status": "RUNNING"
//             }
//         ],
//         "clusterPorts": [
//             5432
//         ],
//         "main": true,
//         "networkingType": "",
//         "publiclyAccessible": false,
//         "allowedIPRanges": null
//     }
// }

// {
//     "id": "instance-o4bd4o16d",
//     "status": "FAILED",
//     "cloud_provider": "aws",
//     "region": "ca-central-1",
//     "network_type": "PUBLIC",
//     "created_at": "2023-06-06 10:41:40.077378 +0000 UTC",
//     "last_modified_at": "2023-06-20 08:08:33.851968 +0000 UTC",
//     "result_params": {},
//     "detailedNetworkTopology": {
//         "r-p8UuvixUZf": {
//             "clusterEndpoint": "",
//             "main": true,
//             "networkingType": "",
//             "publiclyAccessible": false,
//             "allowedIPRanges": null
//         }
//     }
// }
