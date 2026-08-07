export type WorkflowStatus = 'draft'|'processing'|'review'|'complete'|'failed'
export interface AccountDashboard {
  usage:{wordsProcessed:number;wordAllowance:number;remainingWords:number;periodStart:string|null;periodEnd:string|null}
  documents:{total:number;byStatus:Record<WorkflowStatus,number>}
  protectedDetails:{total:number}
  reviewWarnings:{total:number}
  recentDocuments:{documents:Array<{id:string;title:string;wordCount:number;status:WorkflowStatus;updatedAt:string}>}
  notifications:{notifications:Array<{id:string;title:string;body:string;isRead:boolean;readAt:string|null;createdAt:string}>;unreadCount:number}
  usageHistory:{months:Array<{month:string;wordsProcessed:number}>}
  subscription:{planCode:string;planName:string;wordAllowance:number;renewsAt:string|null;billingEnabled:false}
}
