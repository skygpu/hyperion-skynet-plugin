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

    constructor(config: SkynetConfig) {
        super(config);
        this.debug = config.debug
        if (this.baseConfig) {
            this.pluginConfig = this.baseConfig;
            this.loadDeltaHandlers();
        }
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
            handler: (delta: HyperionDelta) => {
                const data = delta.data;
                const hashStr = data.nonce + data.body + data.binary_data
                const requestHash = crypto.createHash('sha256')
                    .update(hashStr)
                    .digest('hex')
                    .toUpperCase();

                delta['@skynetRequestMetadata'] = JSON.parse(data.body);
                delta['@skynetRequestHash'] = requestHash;
            }
        });
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

            const requestSearch = await es.search({
                index: 'skynet-delta-*',
                body: {
                    query: {
                        wildcard: {
                            '@skynetRequestMetadata.params.prompt.keyword': `*${requestParams.prompt}*`
                        }
                    }
                }
            });

            const requestHashes = requestSearch.body.hits.hits.map(hit => hit['@skynetRequestHash']);
            const requests = requestSearch.body.hits.hits.reduce((acc, req) => {
                acc[req['@skynetRequestHash']] = req['@skynetRequestMetadata']
                return acc;
            }, {});

            const matchingSubmits = {};
            for (const hash of requestHashes) {
                const submitSearch = await es.search({
                    index: 'skynet-action-*',
                    body: {
                        query: {
                            match: {
                                'act.data.request_hash': hash
                            }
                        }
                    }
                });
                if (submitSearch.body.total.value > 0)
                    matchingSubmits[hash] = submitSearch.body.hits.hits[0]
            }

            const results = [];
            for (const hash in matchingSubmits) {
                const submit = matchingSubmits[hash]['_source'];
                const metadata = requests[hash];
                results.push({
                    timestamp: submit['@timestamp'],
                    ...submit.act.data,
                    ...metadata
                });
            }

            reply.send(results);
        });

    }

    logDebug(msg: String): void {
        if (this.debug) {
            console.log(msg);
        }
    }
}
