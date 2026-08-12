<!-- section 003 · pages 3–3 · raw/papers/chain-of-thought-prompting.pdf -->
# 3 Arithmetic Reasoning

[[b3-1]] language models can generate chains of thought if demonstrations of chain-of-thought reasoning are provided in the exemplars for few-shot prompting.

[[b3-2]] Figure 1 shows an example of a model producing a chain of thought to solve a math word problem that it would have otherwise gotten incorrect. The chain of thought in this case resembles a solution and can interpreted as one, but we still opt to call it a chain of thought to better capture the idea that it mimics a step-by-step thought process for arriving at the answer (and also, solutions/explanations typically come after the final answer (Narang et al., 2020; Wiegreffe et al., 2022; Lampinen et al., 2022, inter alia)).

[[b3-3]] Chain-of-thought prompting has several attractive properties as an approach for facilitating reasoning in language models.

[[b3-4]] 1. First, chain of thought, in principle, allows models to decompose multi-step problems into

[[b3-5]] intermediate steps, which means that additional computation can be allocated to problems

[[b3-6]] that require more reasoning steps.

[[b3-7]] 2. Second, a chain of thought provides an interpretable window into the behavior of the model,

[[b3-8]] suggesting how it might have arrived at a particular answer and providing opportunities

[[b3-9]] to debug where the reasoning path went wrong (although fully characterizing a model’s

[[b3-10]] computations that support an answer remains an open question).

[[b3-11]] 3. Third, chain-of-thought reasoning can be used for tasks such as math word problems,

[[b3-12]] commonsense reasoning, and symbolic manipulation, and is potentially applicable (at least

[[b3-13]] in principle) to any task that humans can solve via language.

[[b3-14]] 4. Finally, chain-of-thought reasoning can be readily elicited in sufficiently large off-the-shelf

[[b3-15]] language models simply by including examples of chain of thought sequences into the

[[b3-16]] exemplars of few-shot prompting.

[[b3-17]] In empirical experiments, we will observe the utility of chain-of-thought prompting for arithmetic reasoning (Section 3), commonsense reasoning (Section 4), and symbolic reasoning (Section 5).

### [[b3-18]] 3 Arithmetic Reasoning

[[b3-19]] We begin by considering math word problems of the form in Figure 1, which measure the arithmetic reasoning ability of language models. Though simple for humans, arithmetic reasoning is a task where language models often struggle (Hendrycks et al., 2021; Patel et al., 2021, inter alia). Strikingly, chainof-thought prompting when used with the 540B parameter language model performs comparably with task-specific finetuned models on several tasks, even achieving new state of the art on the challenging GSM8K benchmark (Cobbe et al., 2021).

[[b3-20]] 3.1 Experimental Setup

[[b3-21]] We explore chain-of-thought prompting for various language models on multiple benchmarks.

[[b3-22]] Benchmarks. We consider the following five math word problem benchmarks: (1) the GSM8K benchmark of math word problems (Cobbe et al., 2021), (2) the SVAMP dataset of math word problems with varying structures (Patel et al., 2021), (3) the ASDiv dataset of diverse math word problems (Miao et al., 2020), (4) the AQuA dataset of algebraic word problems, and (5) the MAWPS benchmark (Koncel-Kedziorski et al., 2016). Example problems are given in Appendix Table 12.

[[b3-23]] Standard prompting. For the baseline, we consider standard few-shot prompting, popularized by Brown et al. (2020), in which a language model is given in-context exemplars of input–output pairs before outputting a prediction for a test-time example. Exemplars are formatted as questions and answers. The model gives the answer directly, as shown in Figure 1 (left).

[[b3-24]] Chain-of-thought prompting. Our proposed approach is to augment each exemplar in few-shot prompting with a chain of thought for an associated answer, as illustrated in Figure 1 (right). As most of the datasets only have an evaluation split, we manually composed a set of eight few-shot exemplars with chains of thought for prompting—Figure 1 (right) shows one chain of thought exemplar, and the full set of exemplars is given in Appendix Table 20. (These particular exemplars did not undergo prompt engineering; robustness is studied in Section 3.4 and Appendix A.2.) To investigate whether chain-of-thought prompting in this form can successfully elicit successful reasoning across a range of

[[b3-25]] 3
