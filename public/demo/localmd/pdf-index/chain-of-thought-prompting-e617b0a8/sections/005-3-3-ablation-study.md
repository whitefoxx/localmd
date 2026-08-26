<!-- section 005 · pages 5–5 · raw/papers/chain-of-thought-prompting.pdf -->
# 3.3 Ablation Study

[[b5-1]] Second, chain-of-thought prompting has larger performance gains for more-complicated problems. For instance, for GSM8K (the dataset with the lowest baseline performance), performance more than doubled for the largest GPT and PaLM models. On the other hand, for SingleOp, the easiest subset of MAWPS which only requires a single step to solve, performance improvements were either negative or very small (see Appendix Table 3).

[[b5-2]] Third, chain-of-thought prompting via GPT-3 175B and PaLM 540B compares favorably to prior state of the art, which typically finetunes a task-specific model on a labeled training dataset. Figure 4 shows how PaLM 540B uses chain-ofthought prompting to achieve new state of the art on GSM8K, SVAMP, and MAWPS (though note that standard prompting already passed the prior best for SVAMP). On the other two datasets, AQuA and ASDiv, PaLM with chain-of-thought prompting reaches within 2% of the state of the art (Appendix Table 2).

[[b5-3]] To better understand why chain-of-thought prompting works, we manually examined modelgenerated chains of thought by LaMDA 137B for GSM8K. Of 50 random examples where the model returned the correct final answer, all of the generated chains of thought were also logically and mathematically correct except two that coincidentally arrived at the correct answer Figure 4: Chain-of-thought prompting enables (see Appendix D.1, and Table 8 for examples large language models to solve challenging math of correct model-generated chains of thought). problems. Notably, chain-of-thought reasoning We also randomly examined 50 random sam- is an emergent ability of increasing model scale. ples for which the model gave the wrong answer. Prior best numbers are from Cobbe et al. (2021) The summary of this analysis is that 46% of the for GSM8K, Jie et al. (2022) for SVAMP, and Lan chains of thought were almost correct, barring et al. (2021) for MAWPS. minor mistakes (calculator error, symbol mapping error, or one reasoning step missing), and that the other 54% of the chains of thought had major errors in semantic understanding or coherence (see Appendix D.2). To provide a small insight into why scaling improves chain-of-thought reasoning ability, we performed a similar analysis of errors made by PaLM 62B and whether those errors were fixed by scaling to PaLM 540B. The summary is that scaling PaLM to 540B fixes a large portion of one-step missing and semantic understanding errors in the 62B model (see Appendix A.1).

[[b5-4]] 3.3 Ablation Study

[[b5-5]] The observed benefits of using chain-of-thought prompting raises the natural question of whether the same performance improvements can be conferred via other types of prompting. Figure 5 shows an ablation study with three variations of chain of thought described below.

[[b5-6]] Equation only. One reason for why chain-of-thought prompting might help is that it produces the mathematical equation to be evaluated, and so we test a variation where the model is prompted to output only a mathematical equation before giving the answer. Figure 5 shows that equation only prompting does not help much for GSM8K, which implies that the semantics of the questions in GSM8K are too challenging to directly translate into an equation without the natural language reasoning steps in chain of thought. For datasets of one-step or two-step problems, however, we find that equation only prompting does improve performance, since the equation can be easily derived from the question (see Appendix Table 6).

[[b5-7]] 5

[[b5-8]] Standard prompting

[[b5-9]] Chain-of-thought prompting

[[b5-10]] Prior supervised best

[[b5-11]] LaMDA

[[b5-12]] GPT

[[b5-13]] PaLM

[[b5-14]] 60

[[b5-15]] 40

[[b5-16]] GSM8K20

[[b5-17]] solve rate (%)0

[[b5-18]] 80

[[b5-19]] 60

[[b5-20]] 40

[[b5-21]] SVAMP20

[[b5-22]] solve rate (%)

[[b5-23]] 0

[[b5-24]] 100

[[b5-25]] 75

[[b5-26]] 50

[[b5-27]] MAWPS25

[[b5-28]] solve rate (%)

[[b5-29]] 0

[[b5-30]] 0.4 8 137 0.4 7 175 8 62 540

[[b5-31]] Model scale (# parameters in billions)
