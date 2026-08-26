<!-- section 006 · pages 6–6 · raw/papers/chain-of-thought-prompting.pdf -->
# 3.4 Robustness of Chain of Thought

[[b6-1]] Variable compute only. Another intuition is that chain of thought allows the model to spend more computation (i.e., intermediate tokens) on harder problems. To isolate the effect of variable computation from chain-of-thought reasoning, we test a configuration where the model is prompted to output a only sequence of dots (. . .) equal to the number of characters in the equation needed to solve the problem. This variant performs about the same as the baseline, which suggests that variable computation by itself is not the reason for the success of chainof-thought prompting, and that there appears to be utility from expressing intermediate steps via natural language.

[[b6-2]] Chain of thought after answer. Another potential benefit of chain-of-thought prompting could simply be that such prompts allow the model to better access relevant knowledge acquired during pretraining. Therefore, we test an alternative configuration where the chain of thought prompt is only given after the answer, isolating whether the model actually depends on the Figure 5: Ablation study for difproduced chain of thought to give the final answer. This variant ferent variations of prompting usperforms about the same as the baseline, which suggests that ing LaMDA 137B and PaLM 540B. the sequential reasoning embodied in the chain of thought is Results for other datasets are given useful for reasons beyond just activating knowledge.

[[b6-3]] 3.4 Robustness of Chain of Thought

[[b6-4]] Sensitivity to exemplars is a key consideration of prompting approaches—for instance, varying the permutation of few-shot exemplars can cause the accuracy of GPT-3 on SST-2 to range from near chance (54.3%) to near state of the art (93.4%) (Zhao et al., 2021). In this final subsection, we evaluate robustness to chains of thought written by different annotators. In addition to the results above, which used chains of thought written by an Annotator A, two other co-authors of this paper (Annotators B and C) independently wrote chains of thought for the same few-shot exemplars (shown in Appendix H). Annotator A also wrote another chain of thought that was more concise than the original, following the style of solutions given in Cobbe et al. (2021).1

[[b6-5]] Figure 6 shows these results for LaMDA 137B on GSM8K and MAWPS (ablation results for other datasets are given in Appendix Table 6 / Table 7). Although there is variance among different chain of thought annotations, as would be expected when using exemplar-based prompting (Le Scao and Rush, 2021; Reynolds and McDonell, 2021; Zhao Figure 6: Chain-of-thought prompting et al., 2021), all sets of chain of thought prompts outper- has variance for different prompt examform the standard baseline by a large margin. This result ples (as expected) but outperforms stanimplies that successful use of chain of thought does not dard prompting for various annotators as depend on a particular linguistic style.

[[b6-6]] To confirm that successful chain-of-thought prompting works for other sets of exemplars, we also run experiments with three sets of eight exemplars randomly sampled from the GSM8K training set, an independent

[[b6-7]] 1For instance, whereas original chain of thought uses several short sentences (“’There were originally 9 computers. For each of 4 days, 5 more computers were added. So 5 * 4 = 20 computers were added. 9 + 20 is 29.”), the concise chain of thought would read “5 * 4 = 20 new computers were added. So there are 9 + 20 = 29 new computers in the server room now”.

[[b6-8]] 6

[[b6-9]] Standard prompting

[[b6-10]] Equation only

[[b6-11]] Variable compute only

[[b6-12]] Reasoning after answer

[[b6-13]] Chain-of-thought prompting

[[b6-14]] 60

[[b6-15]] 40

[[b6-16]] 20

[[b6-17]] GSM8K solve rate (%)0

[[b6-18]] LaMDA

[[b6-19]] PaLM

[[b6-20]] in Appendix Table 6 and Table 7.

[[b6-21]] Standard prompting

[[b6-22]] Chain-of-thought prompting

[[b6-23]] · different annotator (B)

[[b6-24]] · different annotator (C)

[[b6-25]] · intentionally concise style

[[b6-26]] · exemplars from GSM8K (α)

[[b6-27]] · exemplars from GSM8K (β)

[[b6-28]] · exemplars from GSM8K (γ)

[[b6-29]] 20

[[b6-30]] 60

[[b6-31]] 15

[[b6-32]] 40

[[b6-33]] 10

[[b6-34]] 20

[[b6-35]] Solve rate (%)5

[[b6-36]] 0

[[b6-37]] 0

[[b6-38]] GSM8K

[[b6-39]] MAWPS

[[b6-40]] well as for different exemplars.
