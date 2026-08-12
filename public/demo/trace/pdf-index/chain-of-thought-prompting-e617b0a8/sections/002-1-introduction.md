<!-- section 002 · pages 2–2 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b2-1]] 1 Introduction

[[b2-2]] The NLP landscape has recently been revolutionized by language models (Peters et al., 2018; Devlin et al., 2019; Brown et al., 2020, inter alia). Scaling up the size of language models has been shown to confer a range of benefits, such as improved performance and sample efficiency (Kaplan et al., 2020; Brown et al., 2020, inter alia). However, scaling up model size alone has not proved sufficient for achieving high performance on challenging tasks such asarithmetic, commonsense, and symbolic reasoning (Rae

[[b2-3]] et al., 2021).

[[b2-4]] This work explores how the reasoning ability of large language models can be unlocked by a simple method motivated by two ideas. First, techniques for arithmetic reasoning can benefit from generating natural language rationales that lead to the final answer. Prior work has given models the ability to generate natural language inter- Figure 2: PaLM 540B uses chain-ofmediate steps by training from scratch (Ling et al., 2017) thought prompting to achieve new stateor finetuning a pretrained model (Cobbe et al., 2021), in of-the-art performance on the GSM8K addition to neuro-symbolic methods that use formal lan- benchmark of math word problems. guages instead of natural language (Roy and Roth, 2015; Finetuned GPT-3 and prior best are from Chiang and Chen, 2019; Amini et al., 2019; Chen et al., Cobbe et al. (2021). 2019). Second, large language models offer the exciting prospect of in-context few-shot learning via prompting. That is, instead of finetuning a separate language model checkpoint for each new task, one can simply “prompt” the model with a few input–output exemplars demonstrating the task. Remarkably, this has been successful for a range of simple question-answering tasks (Brown et al., 2020).

[[b2-5]] Both of the above ideas, however, have key limitations. For rationale-augmented training and finetuning methods, it is costly to create a large set of high quality rationales, which is much more complicated than simple input–output pairs used in normal machine learning. For the traditional fewshot prompting method used in Brown et al. (2020), it works poorly on tasks that require reasoning abilities, and often does not improve substantially with increasing language model scale (Rae et al., 2021). In this paper, we combine the strengths of these two ideas in a way that avoids their limitations. Specifically, we explore the ability of language models to perform few-shot prompting for reasoning tasks, given a prompt that consists of triples: 〈input, chain of thought, output〉. A chain of thought is a series of intermediate natural language reasoning steps that lead to the final output, and we refer to this approach as chain-of-thought prompting. An example prompt is shown in Figure 1.

[[b2-6]] We present empirical evaluations on arithmetic, commonsense, and symbolic reasoning benchmarks, showing that chain-of-thought prompting outperforms standard prompting, sometimes to a striking degree. Figure 2 illustrates one such result—on the GSM8K benchmark of math word problems (Cobbe et al., 2021), chain-of-thought prompting with PaLM 540B outperforms standard prompting by a large margin and achieves new state-of-the-art performance. A prompting only approach is important because it does not require a large training dataset and because a single model checkpoint can perform many tasks without loss of generality. This work underscores how large language models can learn via a few examples with natural language data about the task (c.f. automatically learning the patterns underlying inputs and outputs via a large training dataset).

### [[b2-7]] 2 Chain-of-Thought Prompting

[[b2-8]] Consider one’s own thought process when solving a complicated reasoning task such as a multi-step math word problem. It is typical to decompose the problem into intermediate steps and solve each before giving the final answer: “After Jane gives 2 flowers to her mom she has 10 . . . then after she gives 3 to her dad she will have 7 . . . so the answer is 7.” The goal of this paper is to endow language models with the ability to generate a similar chain of thought—a coherent series of intermediate reasoning steps that lead to the final answer for a problem. We will show that sufficiently large

[[b2-9]] 2

[[b2-10]] Finetuned GPT-3 175B

[[b2-11]] Prior best

[[b2-12]] PaLM 540B: standard prompting

[[b2-13]] PaLM 540B: chain-of-thought prompting

[[b2-14]] 100

[[b2-15]] 80

[[b2-16]] 60

[[b2-17]] 55

[[b2-18]] 57

[[b2-19]] 40

[[b2-20]] 33

[[b2-21]] Solve rate (%)20

[[b2-22]] 18

[[b2-23]] 0

[[b2-24]] Math Word Problems (GSM8K)
