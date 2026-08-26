<!-- section 010 · pages 16–16 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b16-1]] A Frequently Asked Questions

[[b16-2]] A.1 Why does increasing model scale improve chain-of-thought prompting?

[[b16-3]] The finding that successful chain-of-thought reasoning predictably emerges only at certain model scales is intriguing. Scaling up language models has been shown to confer benefits such as improved performance and sample efficiency (Kaplan et al., 2020), but chain-of-thought reasoning is emergent in the sense that its success cannot be predicted only by extrapolating the performance of small scale models, as chain of thought actually hurts performance for most models smaller than 10B parameters.

[[b16-4]] The question of why model scale improves chain-of-thought prompting is certainly multi-faceted, and we made a preliminary attempt to shed insight into it via error analysis. This small analysis involved manually reading 45 errors made by PaLM 62B and categorizing them into semantic understanding (20 errors), one step missing (18 errors), and other errors (7 errors). The “other category” included hallucinations, repetitive outputs, and symbol mapping errors. This categorization is a coarse one borrowed from the initial error analysis done on LaMDA in Appendix D.2, for which categories were conceived based on what improvements were needed to make the chain of thought correct.

[[b16-5]] As shown in Figure 9, scaling PaLM to 540B parameters fixed a substantial portion of errors in all three categories. Examples of semantic understanding and one-step missing errors that were fixed by scaling PaLM to 540B are given in Figure 10. This result appears consistent with a hypothesis that language models acquire a range of semantic understanding and logical reasoning skills as a function of model scale (though note that model scale is often conflated with other factors, such as amount of training compute).

[[b16-6]] Types of errors made by

[[b16-7]] a 62B language model:

[[b16-8]] Semantic understanding

[[b16-9]] (62B made 20 errors of this type,

[[b16-10]] 540B fixes 6 of them)

[[b16-11]] One step missing

[[b16-12]] (62B made 18 errors of this type,

[[b16-13]] 540B fixes 12 of them)

[[b16-14]] Errors fixed by

[[b16-15]] Other

[[b16-16]] (62B made 7 errors of this type,

[[b16-17]] 540B fixes 4 of them)

[[b16-18]] Figure 9: Error analysis of 45 problems that PaLM 62B got incorrect. These errors were categorized that semantic understanding, one step missing, and other. The other category includes hallucinations, repetitive outputs, and symbol mapping errors. Scaling PaLM to 540B fixed a substantial portion of errors in all categories.

[[b16-19]] There are also three notable points regarding why small language models fail. The first observation is that small language models fail at even relatively easy symbol mapping tasks. As demonstrated in Section 5, for even symbolic reasoning tasks that only require generalization to new examples using the same chain of thought logical structure that was given in the few-shot exemplars, small language models still failed. The second observation is that small language models seem to have inherently weaker arithmetic abilities, as shown by Brown et al. (2020), the ability to do simple arithmetic operations (without semantic understanding) requires sufficient model scale. Finally, we noticed qualitatively that small language models often did not generate a final answer that could be parsed, due to either repetitions or logic that never arrived at a final answer.

[[b16-20]] In summary, the success of chain-of-thought reasoning as a result of model scale is a complicated phenomena that likely involves a variety of emergent abilities (semantic understanding, symbol mapping, staying on topic, arithmetic ability, faithfulness, etc). Future work could more thoroughly investigate what properties of pretraining data, model architecture, and optimization objective causally enable such reasoning capabilities.

[[b16-21]] 16

[[b16-22]] scaling from

[[b16-23]] 62B to 540B
