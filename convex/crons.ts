import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("poll public model release sources", { minutes: 5 }, internal.polling.pollDueSources);

export default crons;
