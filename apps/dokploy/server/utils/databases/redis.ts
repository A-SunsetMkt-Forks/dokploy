import type { CreateServiceOptions } from "dockerode";
import {
	calculateResources,
	generateBindMounts,
	generateFileMounts,
	generateVolumeMounts,
	prepareEnvironmentVariables,
} from "../docker/utils";
import { getRemoteDocker } from "../servers/remote-docker";
import type { InferResultType } from "@/server/types/with";

export type RedisNested = InferResultType<"redis", { mounts: true }>;
export const buildRedis = async (redis: RedisNested) => {
	const {
		appName,
		env,
		externalPort,
		dockerImage,
		memoryLimit,
		memoryReservation,
		databasePassword,
		cpuLimit,
		cpuReservation,
		command,
		mounts,
	} = redis;

	const defaultRedisEnv = `REDIS_PASSWORD=${databasePassword}${
		env ? `\n${env}` : ""
	}`;
	const resources = calculateResources({
		memoryLimit,
		memoryReservation,
		cpuLimit,
		cpuReservation,
	});
	const envVariables = prepareEnvironmentVariables(defaultRedisEnv);
	const volumesMount = generateVolumeMounts(mounts);
	const bindsMount = generateBindMounts(mounts);
	const filesMount = generateFileMounts(appName, redis);

	const docker = await getRemoteDocker(redis.serverId);

	const settings: CreateServiceOptions = {
		Name: appName,
		TaskTemplate: {
			ContainerSpec: {
				Image: dockerImage,
				Env: envVariables,
				Mounts: [...volumesMount, ...bindsMount, ...filesMount],
				Command: ["/bin/sh"],
				Args: [
					"-c",
					command ? command : `redis-server --requirepass ${databasePassword}`,
				],
			},
			Networks: [{ Target: "dokploy-network" }],
			Resources: {
				...resources,
			},
			Placement: {
				Constraints: ["node.role==manager"],
			},
		},
		Mode: {
			Replicated: {
				Replicas: 1,
			},
		},
		EndpointSpec: {
			Mode: "dnsrr",
			Ports: externalPort
				? [
						{
							Protocol: "tcp",
							TargetPort: 6379,
							PublishedPort: externalPort,
							PublishMode: "host",
						},
					]
				: [],
		},
	};

	try {
		const service = docker.getService(appName);
		const inspect = await service.inspect();
		await service.update({
			version: Number.parseInt(inspect.Version.Index),
			...settings,
		});
	} catch (error) {
		await docker.createService(settings);
	}
};
