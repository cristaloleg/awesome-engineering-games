import * as dotenv from 'dotenv';
import {buildClient, LogLevel} from "@datocms/cma-client-node";
import {ItemInstancesHrefSchema, ItemCreateSchema} from "@datocms/cma-client/dist/types/generated/SimpleSchemaTypes";
import PQueue from 'p-queue';
import {readFileSync} from 'node:fs'
import {resolve} from "node:path";
import {SteamGame} from "./steamTypes";

dotenv.config(); // Read env variables (like the API key) from .env

const client = buildClient({
    apiToken: process.env.DATOCMS_TOKEN as string,
    extraHeaders: {"X-Exclude-Invalid": "true"},
    logLevel: LogLevel.BASIC,
});

const queue = new PQueue({
    timeout: 30000,
    throwOnTimeout: true, // The queue will error if any requests time out
    intervalCap: 10, // Maximum requests per interval cycle. We'll set it a little lower just to be conservative (half the real limit)
    interval: 1000, // Interval cycle. DatoCMS rate limit is 60 requests every 3 seconds (https://www.datocms.com/docs/content-management-api/rate-limits)
    carryoverConcurrencyCount: true,
});

const getRecordIdsByItemType = async (type: ItemInstancesHrefSchema['filter']['type']): Promise<string[]> => {
    console.log(`Fetching all records of type ${type}`);
    let ids: string[] = [];
    for await (const record of client.items.listPagedIterator({
            filter: {type: type},
        },
        {
            perPage: 200,
            concurrency: 3,
        })) {
        ids.push(record.id);
    }
    console.log(`I fetched ${ids.length} record IDs.`);
    return ids;
};

// const allGames = await getRecordIdsByItemType("game");

// console.log(allGames)

const engineeringGames:Array<number> = JSON.parse(readFileSync(resolve(__dirname, `../outputs/steamIds.json`), 'utf8'))
const gfnGames:Set<number> = new Set(JSON.parse(readFileSync(resolve(__dirname, `../outputs/games-on-geforce-now.json`), 'utf8')))

const createNewGameRecord = async (id: number) => {
    const steamDetails:SteamGame = JSON.parse(readFileSync(resolve(__dirname, `../outputs/steamDetails/${id}.json`), 'utf8'))[id].data
    if(!steamDetails) return;
    const capsuleUrl = steamDetails.capsule_image;
    const headerUrl = steamDetails.header_image;

    let tags = []
    if(gfnGames.has(id)) tags.push('gfn')
    if(steamDetails.genres.some(genre => genre.id==='70')) tags.push('early-access')
    if(steamDetails.genres.some(genre => genre.id==='37')) tags.push('f2p')
    if(steamDetails.categories.some(category => category.id === 9 || category.id === 38)) tags.push('co-op')
    if(steamDetails.categories.some(category => category.id === 49 || category.id === 36)) tags.push('pvp')
    if(steamDetails.categories.some(category => category.id === 28 || category.id === 18)) tags.push('controller-support')

    const capsuleImage = capsuleUrl ? await client.uploads.createFromUrl({
        url: capsuleUrl,
        filename: `${id}-capsule`,
        skipCreationIfAlreadyExists: true,
    }) : undefined;

    const headerImage = headerUrl ? await client.uploads.createFromUrl({
        url: headerUrl,
        filename: `${id}-header`,
        skipCreationIfAlreadyExists: true,
    }) : undefined;

    console.log(capsuleImage)

    const data: ItemCreateSchema = {
        item_type: {
            type: 'item_type',
            id: 'MD-Tx1HTQdyQtR5kV5zN5Q'
        },
        steam_id: id.toString(),
        title: steamDetails.name,
        // curator_thoughts: "",
        capsule_image: capsuleImage?.id ? {
           upload_id: capsuleImage.id
        } : undefined,
        header_image: headerImage?.id ? {
            upload_id: headerImage.id
        } : undefined,
        steam_json: JSON.stringify(steamDetails, null, 2),
        tags: JSON.stringify(tags)
    }

    await client.items.create(data)
}


queue.addAll(
    engineeringGames.map(id => () => createNewGameRecord(id))
).then(() => console.log('All done.'))


queue.on('active', () => {
    console.log(`Queue Size: ${queue.size}  Pending: ${queue.pending}`);
});
