<!-- section 004 · pages 4–4 · raw/papers/chain-of-thought-prompting.pdf -->
# 3.2 Results

[[b4-1]] Math Word Problems (free response) Math Word Problems (multiple choice) CSQA (commonsense)

[[b4-2]] Q: Roger has 5 tennis balls. He buys Q: How many keystrokes are needed Q: Sammy wanted to go to where the 2 more cans of tennis balls. Each can to type the numbers from 1 to 500? people were. Where might he go? has 3 tennis balls. How many tennis Answer Choices: (a) 1156 (b) 1392 (c) 1480 Options: (a) race track (b) populated areas balls does he have now? (d) 1562 (e) 1788 (c) desert (d) apartment (e) roadblock

[[b4-3]] A: There are 9 one-digit numbers

[[b4-4]] A: Roger started with 5 balls. 2 cans from 1 to 9. There are 90 two-digit A: The answer must be a place with a of 3 tennis balls each is 6 tennis numbers from 10 to 99. There are lot of people. Race tracks, desert, balls. 5 + 6 = 11. The answer is 11. 401 three-digit numbers from 100 to apartments, and roadblocks don't

[[b4-5]] 500. 9 + 90(2) + 401(3) = 1392. The have a lot of people, but populated

[[b4-6]] answer is (b). areas do. So the answer is (b).

[[b4-7]] StrategyQA Date Understanding Sports Understanding

[[b4-8]] Q: Yes or no: Would a pear sink in Q: The concert was scheduled to be Q: Is the following sentence

[[b4-9]] water? on 06/01/1943, but was delayed by plausible? "Joao Moutinho caught the

[[b4-10]] one day to today. What is the date 10 screen pass in the NFC

[[b4-11]] A: The density of a pear is about 0.6 days ago in MM/DD/YYYY? championship."

[[b4-12]] g/cm^3, which is less than water.

[[b4-13]] Thus, a pear would float. So the A: One day after 06/01/1943 is A: Joao Moutinho is a soccer player. answer is no. 06/02/1943, so today is 06/02/1943. The NFC championship is part of

[[b4-14]] 10 days before today is 05/23/1943. American football, not soccer. So the

[[b4-15]] So the answer is 05/23/1943. answer is no.

[[b4-16]] SayCan (Instructing a robot) Last Letter Concatenation Coin Flip (state tracking) Human: How would you bring me Q: Take the last letters of the words Q: A coin is heads up. Maybelle flips something that isn’t a fruit? in “Lady Gaga” and concatenate the coin. Shalonda does not flip the

[[b4-17]] them. coin. Is the coin still heads up? Explanation: the user wants

[[b4-18]] something to eat that isn’t a fruit. An A: The last letter of “Lady” is “y”. The A: The coin was flipped by Maybelle. energy bar is not a fruit, so I will bring last letter of “Gaga” is “a”. So the coin was flipped 1 time, which the user an energy bar. Concatenating them is “ya”. So the is an odd number. The coin started Plan: 1. find(energy bar) 2. answer is ya. heads up, so after an odd number of pick(energy bar) 3. find(user) 4. flips, it will be tails up. So the answer put(energy bar) 5. done(). is no.

[[b4-19]] Figure 3: Examples of 〈input, chain of thought, output〉 triples for arithmetic, commonsense, and symbolic reasoning benchmarks. Chains of thought are highlighted. Full prompts in Appendix G.

[[b4-20]] math word problems, we used this single set of eight chain of thought exemplars for all benchmarks except AQuA, which is multiple choice instead of free response. For AQuA, we used four exemplars and solutions from the training set, as given in Appendix Table 21.

[[b4-21]] Language models. We evaluate five large language models. The first is GPT-3 (Brown et al., 2020), for which we use text-ada-001, text-babbage-001, text-curie-001, and text-davinci-002, which presumably correspond to InstructGPT models of 350M, 1.3B, 6.7B, and 175B parameters (Ouyang et al., 2022).The second is LaMDA (Thoppilan et al., 2022), which has models of 422M, 2B, 8B, 68B, and 137B parameters. The third is PaLM, which has models of 8B, 62B, and 540B parameters. The fourth is UL2 20B (Tay et al., 2022), and the fifth is Codex (Chen et al., 2021, code-davinci-002 in the OpenAI API). We sample from the models via greedy decoding (though follow-up work shows chain-of-thought prompting can be improved by taking the majority final answer over many sampled generations (Wang et al., 2022a)). For LaMDA, we report averaged results over five random seeds, where each seed had a different randomly shuffled order of exemplars. As LaMDA experiments did not show large variance among different seeds, to save compute we report results for a single exemplar order for all other models.

[[b4-22]] 3.2 Results

[[b4-23]] The strongest results of chain-of-thought prompting are summarized in Figure 4, with all experimental outputs for each model collection, model size, and benchmark shown in Table 2 in the Appendix. There are three key takeaways. First, Figure 4 shows that chain-of-thought prompting is an emergent ability of model scale (Wei et al., 2022b). That is, chain-of-thought prompting does not positively impact performance for small models, and only yields performance gains when used with models of ∼100B parameters. We qualitatively found that models of smaller scale produced fluent but illogical chains of thought, leading to lower performance than standard prompting.

[[b4-24]] 4
