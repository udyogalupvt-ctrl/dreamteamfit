import type { AttendanceEventType, BiometricDevice } from "@/types/models";

export interface DeviceAttendanceLog { eventId:string; biometricUserId:string; eventType:AttendanceEventType; timestamp:Date }
export interface BiometricAdapter {
 connect():Promise<void>; disconnect():Promise<void>; getDeviceInfo():Promise<Record<string,string>>;
 getUsers():Promise<Array<{userId:string;name?:string}>>; createUser(userId:string,name:string):Promise<void>;
 updateUser(userId:string,name:string):Promise<void>; disableUser(userId:string):Promise<void>;
 deleteUser(userId:string):Promise<void>; getAttendanceLogs():Promise<DeviceAttendanceLog[]>; testConnection():Promise<{ok:boolean;message:string}>;
}
const unavailable=async()=>{throw new Error("Hardware adapter not configured.")};
class PlaceholderAdapter implements BiometricAdapter {
 connect=unavailable; disconnect=async()=>{}; getDeviceInfo=unavailable; getUsers=unavailable; createUser=unavailable; updateUser=unavailable; disableUser=unavailable; deleteUser=unavailable; getAttendanceLogs=unavailable;
 async testConnection(){return {ok:false,message:"Hardware adapter not configured."}}
}
export class ESSLAdapter extends PlaceholderAdapter {}
export class ZKTecoAdapter extends PlaceholderAdapter {}
export class MockBiometricAdapter implements BiometricAdapter {
 constructor(private logs:DeviceAttendanceLog[]=[]){ }
 async connect(){} async disconnect(){} async getDeviceInfo(){return {adapter:"Mock biometric device"}} async getUsers(){return []}
 async createUser(){} async updateUser(){} async disableUser(){} async deleteUser(){} async getAttendanceLogs(){return this.logs}
 async testConnection(){return {ok:true,message:"Mock adapter is ready."}}
}
export function adapterFor(device:BiometricDevice):BiometricAdapter {if(device.integrationType==="mock")return new MockBiometricAdapter();if(device.manufacturer==="eSSL")return new ESSLAdapter();return new ZKTecoAdapter()}
