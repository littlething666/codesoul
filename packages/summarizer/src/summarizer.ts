export type CommunitySummaryInput = {
	communityId: string
	nodeIds: ReadonlyArray<string>
	signals: { qualifiedNames: string[]; paths: string[] }
}

export type CommunitySummary = {
	communityId: string
	title: string
	description: string
	modelId: string
}

export interface Summarizer {
	readonly modelId: string
	summarizeCommunity(input: CommunitySummaryInput): Promise<CommunitySummary>
}
