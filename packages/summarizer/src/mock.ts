import type {
	CommunitySummary,
	CommunitySummaryInput,
	Summarizer,
} from "./summarizer.js"

export class MockSummarizer implements Summarizer {
	readonly modelId = "mock-summarizer"

	async summarizeCommunity(
		input: CommunitySummaryInput,
	): Promise<CommunitySummary> {
		const names = input.signals.qualifiedNames.slice(0, 3).join(", ")
		const suffix = names ? `: ${names}` : ""
		return {
			communityId: input.communityId,
			title: `<community of ${input.nodeIds.length} nodes>`,
			description: `<community of ${input.nodeIds.length} nodes${suffix}>`,
			modelId: this.modelId,
		}
	}
}
