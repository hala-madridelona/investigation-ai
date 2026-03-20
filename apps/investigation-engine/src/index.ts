import type {
  EvaluateInvestigationRequest,
  ExecuteInvestigationRequest,
  FinalizeInvestigationRequest,
  InitInvestigationRequest,
  PlanInvestigationRequest,
} from '@investigation-ai/workflow-contracts';

export const routes = {
  init: (_request: InitInvestigationRequest): '/init' => '/init',
  plan: (_request: PlanInvestigationRequest): '/plan' => '/plan',
  execute: (_request: ExecuteInvestigationRequest): '/execute' => '/execute',
  evaluate: (_request: EvaluateInvestigationRequest): '/evaluate' => '/evaluate',
  finalize: (_request: FinalizeInvestigationRequest): '/finalize' => '/finalize',
};
