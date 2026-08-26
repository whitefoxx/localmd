<!-- section 001 · pages 1–1 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b1-1]] Chain-of-Thought Prompting Elicits Reasoning

### [[b1-2]] in Large Language Models

[[b1-3]] Jason Wei

[[b1-4]] Brian Ichter

[[b1-5]] We explore how generating a chain of thought—a series of intermediate reasoning steps—significantly improves the ability of large language models to perform complex reasoning. In particular, we show how such reasoning abilities emerge naturally in sufficiently large language models via a simple method called chain-ofthought prompting, where a few chain of thought demonstrations are provided as exemplars in prompting. Experiments on three large language models show that chain-of-thought prompting improves performance on a range of arithmetic, commonsense, and symbolic reasoning tasks. The empirical gains can be striking. For instance, prompting a PaLM 540B with just eight chain-of-thought exemplars achieves state-of-the-art accuracy on the GSM8K benchmark of math word problems, surpassing even finetuned GPT-3 with a verifier.

[[b1-6]] Standard Prompting

[[b1-7]] Model Input

[[b1-8]] Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 tennis balls. How many tennis balls does he have now?

[[b1-9]] A: The answer is 11.

[[b1-10]] Q: The cafeteria had 23 apples. If they used 20 to make lunch and bought 6 more, how many apples

## [[b1-11]] arXiv:2201.11903v6 [cs.CL] 10 Jan 2023do they have?

[[b1-12]] Model Output

[[b1-13]] A: The answer is 27.

[[b1-14]] Figure 1: Chain-of-thought prompting enables large language models to tackle complex arithmetic, commonsense, and symbolic reasoning tasks. Chain-of-thought reasoning processes are highlighted.

[[b1-15]] 36th Conference on Neural Information Processing Systems (NeurIPS 2022).

[[b1-16]] Xuezhi Wang

[[b1-17]] Dale Schuurmans

[[b1-18]] Maarten Bosma

[[b1-19]] Fei Xia

[[b1-20]] Ed H. Chi

[[b1-21]] Quoc V. Le

[[b1-22]] Denny Zhou

[[b1-23]] Google Research, Brain Team

[[b1-24]] {jasonwei,dennyzhou}@google.com

### [[b1-25]] Abstract

[[b1-26]] Chain-of-Thought Prompting

[[b1-27]] Model Input

[[b1-28]] Q: Roger has 5 tennis balls. He buys 2 more cans of

[[b1-29]] tennis balls. Each can has 3 tennis balls. How many

[[b1-30]] tennis balls does he have now?

[[b1-31]] A: Roger started with 5 balls. 2 cans of 3 tennis balls

[[b1-32]] each is 6 tennis balls. 5 + 6 = 11. The answer is 11.

[[b1-33]] Q: The cafeteria had 23 apples. If they used 20 to

[[b1-34]] make lunch and bought 6 more, how many apples

[[b1-35]] do they have?

[[b1-36]] Model Output

[[b1-37]] A: The cafeteria had 23 apples originally. They used

[[b1-38]] 20 to make lunch. So they had 23 - 20 = 3. They

[[b1-39]] bought 6 more apples, so they have 3 + 6 = 9. The

[[b1-40]] answer is 9.
