import type { AccessDecision } from "@/types/models";
export interface AccessController { grantAccess(decision:AccessDecision):Promise<{message:string}>; denyAccess(decision:AccessDecision):Promise<{message:string}> }
export class MockAccessController implements AccessController {
 async grantAccess(){return {message:"Access granted (simulation only)."}}
 async denyAccess(){return {message:"Access denied (simulation only)."}}
}
