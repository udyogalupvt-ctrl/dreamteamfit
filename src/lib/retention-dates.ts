import { addDays,format,parseISO } from "date-fns";
export const AUTOMATION_TIMEZONE="Asia/Kolkata";
export function indiaToday(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:AUTOMATION_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(now)}
export const addDaysISOValue=(iso:string,days:number)=>format(addDays(parseISO(iso),days),"yyyy-MM-dd");
export const birthdayMonthDay=(dob:string)=>/^\d{4}-\d{2}-\d{2}$/.test(dob)?dob.slice(5):"";
export const deterministicId=(...parts:string[])=>parts.join("__").replace(/[^a-zA-Z0-9_-]/g,"_");
