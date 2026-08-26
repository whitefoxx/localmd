<!-- section 004 · pages 4–4 · raw/papers/chain-of-thought-prompting.pdf -->
# 3.2 Results

[[b4-1]] Math Word Problems (free response)

[[b4-2]] Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 tennis balls. How many tennis balls does he have now?

[[b4-3]] A: Roger started with 5 balls. 2 cans of 3 tennis balls each is 6 tennis balls. 5 + 6 = 11. The answer is 11.

[[b4-4]] 500. 9 + 90(2) + 401(3) = 1392. The

[[b4-5]] answer is (b).

[[b4-6]] StrategyQA

[[b4-7]] Q: Yes or no: Would a pear sink in water?

[[b4-8]] one day to today. What is the date 10 A: The density of a pear is about 0.6 g/cm^3, which is less than water. Thus, a pear would float. So the answer is no.

[[b4-9]] 10 days before today is 05/23/1943.

[[b4-10]] So the answer is 05/23/1943.

[[b4-11]] SayCan (Instructing a robot)

[[b4-12]] Human: How would you bring me something that isn’t a fruit?

[[b4-13]] them. Explanation: the user wants something to eat that isn’t a fruit. An energy bar is not a fruit, so I will bring the user an energy bar. Plan: 1. find(energy bar) 2. pick(energy bar) 3. find(user) 4. put(energy bar) 5. done().

[[b4-14]] Figure 3: Examples of 〈input, chain of thought, output〉 triples for arithmetic, commonsense, and symbolic reasoning benchmarks. Chains of thought are highlighted. Full prompts in Appendix G.

[[b4-15]] math word problems, we used this single set of eight chain of thought exemplars for all benchmarks except AQuA, which is multiple choice instead of free response. For AQuA, we used four exemplars and solutions from the training set, as given in Appendix Table 21.

[[b4-16]] Language models. We evaluate five large language models. The first is GPT-3 (Brown et al., 2020), for which we use text-ada-001, text-babbage-001, text-curie-001, and text-davinci-002, which presumably correspond to InstructGPT models of 350M, 1.3B, 6.7B, and 175B parameters (Ouyang et al., 2022).The second is LaMDA (Thoppilan et al., 2022), which has models of 422M, 2B, 8B, 68B, and 137B parameters. The third is PaLM, which has models of 8B, 62B, and 540B parameters. The fourth is UL2 20B (Tay et al., 2022), and the fifth is Codex (Chen et al., 2021, code-davinci-002 in the OpenAI API). We sample from the models via greedy decoding (though follow-up work shows chain-of-thought prompting can be improved by taking the majority final answer over many sampled generations (Wang et al., 2022a)). For LaMDA, we report averaged results over five random seeds, where each seed had a different randomly shuffled order of exemplars. As LaMDA experiments did not show large variance among different seeds, to save compute we report results for a single exemplar order for all other models.

[[b4-17]] 3.2 Results

[[b4-18]] The strongest results of chain-of-thought prompting are summarized in Figure 4, with all experimental outputs for each model collection, model size, and benchmark shown in Table 2 in the Appendix. There are three key takeaways. First, Figure 4 shows that chain-of-thought prompting is an emergent ability of model scale (Wei et al., 2022b). That is, chain-of-thought prompting does not positively impact performance for small models, and only yields performance gains when used with models of ∼100B parameters. We qualitatively found that models of smaller scale produced fluent but illogical chains of thought, leading to lower performance than standard prompting.

[[b4-19]] 4

[[b4-20]] Math Word Problems (multiple choice)

[[b4-21]] CSQA (commonsense)

[[b4-22]] Q: How many keystrokes are needed

[[b4-23]] Q: Sammy wanted to go to where the

[[b4-24]] to type the numbers from 1 to 500?

[[b4-25]] people were. Where might he go?

[[b4-26]] Answer Choices: (a) 1156 (b) 1392 (c) 1480

[[b4-27]] Options: (a) race track (b) populated areas

[[b4-28]] (d) 1562 (e) 1788

[[b4-29]] (c) desert (d) apartment (e) roadblock

[[b4-30]] A: There are 9 one-digit numbers

[[b4-31]] from 1 to 9. There are 90 two-digit

[[b4-32]] A: The answer must be a place with a

[[b4-33]] numbers from 10 to 99. There are

[[b4-34]] lot of people. Race tracks, desert,

[[b4-35]] 401 three-digit numbers from 100 to

[[b4-36]] apartments, and roadblocks don't

[[b4-37]] have a lot of people, but populated

[[b4-38]] areas do. So the answer is (b).

[[b4-39]] Date Understanding

[[b4-40]] Sports Understanding

[[b4-41]] Q: The concert was scheduled to be

[[b4-42]] Q: Is the following sentence

[[b4-43]] on 06/01/1943, but was delayed by

[[b4-44]] plausible? "Joao Moutinho caught the

[[b4-45]] screen pass in the NFC

[[b4-46]] days ago in MM/DD/YYYY?

[[b4-47]] championship."

[[b4-48]] A: One day after 06/01/1943 is

[[b4-49]] A: Joao Moutinho is a soccer player.

[[b4-50]] 06/02/1943, so today is 06/02/1943.

[[b4-51]] The NFC championship is part of

[[b4-52]] American football, not soccer. So the

[[b4-53]] answer is no.

[[b4-54]] Last Letter Concatenation

[[b4-55]] Coin Flip (state tracking)

[[b4-56]] Q: Take the last letters of the words

[[b4-57]] Q: A coin is heads up. Maybelle flips

[[b4-58]] in “Lady Gaga” and concatenate

[[b4-59]] the coin. Shalonda does not flip the

[[b4-60]] coin. Is the coin still heads up?

[[b4-61]] A: The last letter of “Lady” is “y”. The

[[b4-62]] A: The coin was flipped by Maybelle.

[[b4-63]] last letter of “Gaga” is “a”.

[[b4-64]] So the coin was flipped 1 time, which

[[b4-65]] Concatenating them is “ya”. So the

[[b4-66]] is an odd number. The coin started

[[b4-67]] answer is ya.

[[b4-68]] heads up, so after an odd number of

[[b4-69]] flips, it will be tails up. So the answer

[[b4-70]] is no.
