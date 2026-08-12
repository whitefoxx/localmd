<!-- section 001 · pages 1–1 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b1-1]] Chain-of-Thought Prompting Elicits Reasoning in Large Language Models

[[b1-2]] Jason Wei Xuezhi Wang Dale Schuurmans Maarten Bosma

[[b1-3]] Brian Ichter Fei Xia Ed H. Chi Quoc V. Le Denny Zhou

[[b1-4]] Google Research, Brain Team {jasonwei,dennyzhou}@google.com

### [[b1-5]] Abstract

[[b1-6]] We explore how generating a chain of thought—a series of intermediate reasoning steps—significantly improves the ability of large language models to perform complex reasoning. In particular, we show how such reasoning abilities emerge naturally in sufficiently large language models via a simple method called chain-ofthought prompting, where a few chain of thought demonstrations are provided as exemplars in prompting. Experiments on three large language models show that chain-of-thought prompting improves performance on a range of arithmetic, commonsense, and symbolic reasoning tasks. The empirical gains can be striking. For instance, prompting a PaLM 540B with just eight chain-of-thought exemplars achieves state-of-the-art accuracy on the GSM8K benchmark of math word problems, surpassing even finetuned GPT-3 with a verifier.

[[b1-7]] Standard Prompting Chain-of-Thought Prompting

[[b1-8]] Model Input Model Input

[[b1-9]] Q: Roger has 5 tennis balls. He buys 2 more cans of Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 tennis balls. How many tennis balls. Each can has 3 tennis balls. How many tennis balls does he have now? tennis balls does he have now?

[[b1-10]] A: The answer is 11. A: Roger started with 5 balls. 2 cans of 3 tennis balls each is 6 tennis balls. 5 + 6 = 11. The answer is 11. Q: The cafeteria had 23 apples. If they used 20 to make lunch and bought 6 more, how many apples Q: The cafeteria had 23 apples. If they used 20 to

## [[b1-11]] arXiv:2201.11903v6 [cs.CL] 10 Jan 2023do they have? make lunch and bought 6 more, how many apples

[[b1-12]] do they have?

[[b1-13]] Model Output Model Output

[[b1-14]] A: The answer is 27. A: The cafeteria had 23 apples originally. They used 20 to make lunch. So they had 23 - 20 = 3. They bought 6 more apples, so they have 3 + 6 = 9. The answer is 9.

[[b1-15]] Figure 1: Chain-of-thought prompting enables large language models to tackle complex arithmetic, commonsense, and symbolic reasoning tasks. Chain-of-thought reasoning processes are highlighted.

[[b1-16]] 36th Conference on Neural Information Processing Systems (NeurIPS 2022).
