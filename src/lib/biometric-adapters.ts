import type { AttendanceEventType, BiometricDevice } from "@/types/models";

export interface DeviceAttendanceLog { eventId:string; biometricUserId:string; eventType:AttendanceEventType; timestamp:Date }
export interface BiometricAdapter {
 connect():Promise<void>; disconnect():Promise<void>; getDeviceInfo():Promise<Record<string,string>>;
 getUsers():Promise<Array<{userId:string;name?:string}>>; createUser(userId:string,name:string):Promise<void>;
 updateUser(userId:string,name:string):Promise<void>; disableUser(userId:string):Promise<void>;
 deleteUser(userId:string):Promise<void>; getAttendanceLogs():Promise<DeviceAttendanceLog[]>; testConnection():Promise<{ok:boolean;message:string}>;
 /** Put device in enrollment mode and wait for confirmed first-thumb capture. Must only resolve ok:true on real device confirmation. */
 enrollFingerprint(userId:string,name:string):Promise<{ok:boolean;message:string}>;
}
const unavailable=async()=>{throw new Error("Biometric hardware integration is not configured.")};
class PlaceholderAdapter implements BiometricAdapter {
 connect=unavailable; disconnect=async()=>{}; getDeviceInfo=unavailable; getUsers=unavailable; createUser=unavailable; updateUser=unavailable; disableUser=unavailable; deleteUser=unavailable; getAttendanceLogs=unavailable;
 async enrollFingerprint(){return {ok:false,message:"Biometric hardware integration is not configured. Membership activation is pending biometric registration."}}
 async testConnection(){return {ok:false,message:"Hardware adapter not configured."}}
}
export class ESSLAdapter extends PlaceholderAdapter {}
export class ZKTecoAdapter extends PlaceholderAdapter {}
export class MockBiometricAdapter implements BiometricAdapter {
 constructor(private logs:DeviceAttendanceLog[]=[]){ }
 async connect(){} async disconnect(){} async getDeviceInfo(){return {adapter:"Mock biometric device"}} async getUsers(){return []}
 async createUser(){} async updateUser(){} async disableUser(){} async deleteUser(){} async getAttendanceLogs(){return this.logs}
 async testConnection(){return {ok:true,message:"Mock adapter is ready (development only)."}}
 /** Development mock never confirms a real thumb, so it can never activate a member. */
 async enrollFingerprint(){return {ok:false,message:"Development mock device cannot register real fingerprints. Connect a real eSSL/ZKTeco adapter to activate members."}}
}
export function adapterFor(device:BiometricDevice):BiometricAdapter {if(device.integrationType==="mock")return new MockBiometricAdapter();if(device.manufacturer==="eSSL")return new ESSLAdapter();return new ZKTecoAdapter()}
