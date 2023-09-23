import {HyperionPlugin} from "../../hyperion-plugin";
import {FastifyInstance, FastifyRequest, FastifyReply} from "fastify";
import fetch from "node-fetch";
import autoLoad from '@fastify/autoload';
import {join} from "path";
import {HyperionAction} from "../../../interfaces/hyperion-action";
import {HyperionDelta} from "../../../interfaces/hyperion-delta";
import crypto from 'crypto';
import {SkynetConfig, SkynetAPIRequestSearch} from './types/index';

import {
    Action,
    APIClient,
    FetchProvider,
    Name,
    PrivateKey,
    SignedTransaction,
    Struct,
    Transaction as AntelopeTransaction,
} from '@greymass/eosio'


function isOlderThanADay(timestamp: string): boolean {
  const timestampDate = new Date(timestamp);
  const now = new Date();
  const dayInMilliseconds = 24 * 60 * 60 * 1000;

  return now.getTime() - timestampDate.getTime() > dayInMilliseconds;
}


export default class Skynet extends HyperionPlugin {
    internalPluginName = 'skynet-gpu';
    apiPlugin = true;
    indexerPlugin = true;
    hasApiRoutes = true;
    debug = false;

    actionHandlers = [];
    deltaHandlers = [];

    pluginConfig: SkynetConfig;

    requestsInProgress: {};

    constructor(config: SkynetConfig) {
        super(config);
        this.debug = config.debug
        if (this.baseConfig) {
            this.pluginConfig = this.baseConfig;
            this.loadDeltaHandlers();
            this.loadActionHandlers();
        }
    }

    handleQueueDelta(delta: HyperionDelta) {
        const data = delta.data;
        const hashStr = data.nonce + data.body + data.binary_data
        const requestHash = crypto.createHash('sha256')
            .update(hashStr)
            .digest('hex')
            .toUpperCase();

        delta['@skynetRequestHash'] = requestHash;

        this.requestsInProgress[requestHash] = delta.data;
    }

    handleSubmitAction(action: HyperionAction) {
        const requestHash = action.act.data.request_hash;
        const requestData = this.requestsInProgress[requestHash]
        const reqBody = JSON.parse(requestData.body);
        action['@skynetRequestMetadata'] = {
            ...this.requestsInProgress[requestHash],
            ...reqBody.params

        };
        this.cleanupRequests(requestHash);
    }

    loadDeltaHandlers() {
        this.deltaHandlers.push({
            table: 'queue',
            contract: this.pluginConfig.contract,
            mappings: {
                delta: {
                    "@skynetRequestHash": {"type": "keyword"}
                }
            },
            handler: this.handleQueueDelta.bind(this)
        });
    }

    loadActionHandlers() {
        this.actionHandlers.push({
            action: 'submit',
            contract: this.pluginConfig.contract,
            mappings: {
                action: {
                    "@skynetRequestMetadata": {
                        "properties": {
                            "id": {"type": "keyword"},
                            "min_verification": {"type": "byte"},
                            "nonce": {"type": "long"},
                            "reward": {"type": "keyword"},
                            "timestamp": {"type": "keyword"},
                            "user": {"type": "keyword"},
                            "prompt": {"type": "keyword"},
                            "model": {"type": "keyword"},
                            "width": {"type": "keyword"},
                            "height": {"type": "keyword"}
                        }
                    }
                }
            },
            handler: this.handleSubmitAction.bind(this)
        });
    }

    cleanupRequests(hash: string) {
        delete this.requestsInProgress[hash];

        for (const h in this.requestsInProgress)
            if (isOlderThanADay(this.requestsInProgress[h]))
                delete this.requestsInProgress[h];
    }

    addRoutes(server: FastifyInstance): void {
        const es = server.manager.esIngestClient;

        const searchSchema = {
            body: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                    model: { type: 'string' },
                },
                required: []
            }
        };

        server.post('/v2/skynet/search', {schema: searchSchema}, async (request: FastifyRequest, reply: FastifyReply) => {
            const requestParams = request.body as SkynetAPIRequestSearch;
            const prompt = '*' + requestParams.prompt + '*';

            const { body } = await es.search({
                index: 'skynet-action-*',
                body: {
                    query: {
                        wildcard: {
                            '@skynetRequestMetadata.prompt': {
                                value: prompt
                            }
                        }
                    }
                }
            });
            reply.send(body.hits);
        });

    }

    logDebug(msg: String): void {
        if (this.debug) {
            console.log(msg);
        }
    }
}
