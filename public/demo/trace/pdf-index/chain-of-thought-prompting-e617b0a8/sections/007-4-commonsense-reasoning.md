<!-- section 007 · pages 7–7 · raw/papers/chain-of-thought-prompting.pdf -->
# 4 Commonsense Reasoning

[[b7-1]] source (examples in this dataset already included reasoning steps like a chain of thought).2 Figure 6 shows that these prompts performed comparably with our manually written exemplars, also substantially outperforming standard prompting.

[[b7-2]] In addition to robustness to annotators, independently-written chains of thought, different exemplars, and various language models, we also find that chain-of-thought prompting for arithmetic reasoning is robust to different exemplar orders and varying numbers of exemplars (see Appendix A.2).

### [[b7-3]] 4 Commonsense Reasoning

[[b7-4]] Although chain of thought is particularly suitable for math word problems, the language-based nature of chain of thought actually makes it applicable to a broad class of commonsense reasoning problems, which involve reasoning about physical and human interactions under the presumption of general background knowledge. Commonsense reasoning is key for interacting with the world and is still beyond the reach of current natural language understanding systems (Talmor et al., 2021).

[[b7-5]] Benchmarks. We consider five datasets covering a diverse range of commonsense reasoning types. The popular CSQA (Talmor et al., 2019) asks commonsense questions about the world involving complex semantics that often require prior knowledge. StrategyQA (Geva et al., 2021) requires models to infer a multi-hop strategy to answer questions. We choose two specialized evaluation sets from the BIG-bench effort (BIG-bench collaboration, 2021): Date Understanding, which involves inferring a date from a given context, and Sports Understanding, which involves determining whether a sentence relating to sports is plausible or implausible. Finally, the SayCan dataset (Ahn et al., 2022) involves mapping a natural language instruction to a sequence of robot actions from a discrete set. Figure 3 shows examples with chain of thought annotations for all datasets.

[[b7-6]] Prompts. We follow the same experimental setup as the prior section. For CSQA and StrategyQA, we randomly selected examples from the training set and manually composed chains of thought for them to use as few-shot exemplars. The two BIG-bench tasks do not have training sets, so we selected the first ten examples as exemplars in the evaluation set as few-shot exemplars and report numbers on the rest of the evaluation set. For SayCan, we use six examples from the training set used in Ahn et al. (2022) and also manually composed chains of thought.

[[b7-7]] Results. Figure 7 highlights these results for PaLM (full results for LaMDA, GPT-3, and different model scales are shown in Table 4). For all tasks, scaling up model size improved the performance of standard prompting; chain-of-thought prompting led to further gains, with improvements appearing to be largest for PaLM 540B. With chain-of-thought prompting, PaLM 540B achieved strong performance relative to baselines, outperforming the prior state of the art on StrategyQA (75.6% vs 69.4%) and outperforming an unaided sports enthusiast on sports understanding (95.4% vs 84%). These results demonstrate that chain-of-thought prompting can also improve performance on tasks requiring a range of commonsense reasoning abilities (though note that gain was minimal on CSQA).

[[b7-8]] CSQA

[[b7-9]] 100

[[b7-10]] 80

[[b7-11]] 80

[[b7-12]] 60

[[b7-13]] 40

[[b7-14]] Solve rate (%)

[[b7-15]] 20

[[b7-16]] 8 62 540

[[b7-17]] Figure 7: Chain-of-thought prompting also improves the commonsense reasoning abilities of language models. The language model shown here is PaLM. Prior best numbers are from the leaderboards of CSQA (Talmor et al., 2019) and StrategyQA (Geva et al., 2021) (single-model only, as of May 5, 2022). Additional results using various sizes of LaMDA, GPT-3, and PaLM are shown in Table 4.

[[b7-18]] 2We sample examples ≤ 60 tokens to fit into our input context window, and also limit the examples to ≤ 2 steps to solve for a fair comparison with the eight exemplars that we composed.

[[b7-19]] 7

[[b7-20]] StrategyQA

[[b7-21]] Date

[[b7-22]] Sports

[[b7-23]] SayCan

[[b7-24]] 90

[[b7-25]] 80

[[b7-26]] 100

[[b7-27]] 100

[[b7-28]] 80

[[b7-29]] 60

[[b7-30]] 80

[[b7-31]] Standard prompting

[[b7-32]] Chain of thought

[[b7-33]] 70

[[b7-34]] 40

[[b7-35]] 60

[[b7-36]] Prior supervised best

[[b7-37]] 60

[[b7-38]] 60

[[b7-39]] 20

[[b7-40]] 40

[[b7-41]] Human

[[b7-42]] 50

[[b7-43]] 0

[[b7-44]] 40

[[b7-45]] 20

[[b7-46]] 8 62 540

[[b7-47]] 8 62 540

[[b7-48]] 8 62 540

[[b7-49]] 8 62 540

[[b7-50]] Model scale (# parameters in billions)
