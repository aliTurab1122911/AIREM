import { Queue } from 'bullmq';
import IORedis from 'ioredis';
export const JOB_QUEUE = 'airem-processing';
export interface JobQueue { add(id:string):Promise<void>; cancel(id:string):Promise<boolean>; close():Promise<void> }
export const redisConnection=(url:string)=>new IORedis(url,{maxRetriesPerRequest:null});
export class RedisJobQueue implements JobQueue {
 private queue:Queue; constructor(url:string){this.queue=new Queue(JOB_QUEUE,{connection:redisConnection(url)});}
 async add(id:string){await this.queue.add('process',{id},{jobId:id,attempts:3,backoff:{type:'exponential',delay:2000},removeOnComplete:500,removeOnFail:1000});}
 async cancel(id:string){const job=await this.queue.getJob(id);if(!job||!['waiting','delayed'].includes(await job.getState()))return false;await job.remove();return true;}
 async close(){await this.queue.close();}
}
