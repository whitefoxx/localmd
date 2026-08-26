<!-- section 016 · pages 25–26 · raw/papers/chain-of-thought-prompting.pdf -->
# D Appendix: Additional Analysis

[[b25-1]] Perhaps the most-related work here is Recchia (2021), which shows that finetuning enables longhand module operations, which has previously been difficult for performers. Whereas work in this direction is often task-specific and uses finetuning, we show that chain-of-thought prompting works for a broad range of tasks without any finetuning.

[[b25-2]] C.5 Intermediate language steps

[[b25-3]] Extensive prior work has shown the benefits of endowing neural networks with the ability to produce intermediate steps via training or finetuning confers various benefits in a range of scenarios. As examples, it has been shown that natural language intermediate steps can improve performance (Zaidan et al., 2007; Yao et al., 2021; Hase and Bansal, 2022; Gu et al., 2022), improve robustness (Chen et al., 2022), speed up training (Hancock et al., 2018), mitigate bias (Dua et al., 2020), and even help in image and reinforcement learning settings (Andreas et al., 2018). To endow models with the ability to produce intermediate steps, prior work typically finetunes models on either manually annotated training datasets (Camburu et al., 2018; Rajani et al., 2019, inter alia) or generates synthetic datasets (Talmor et al., 2020; Zelikman et al., 2022). Compared with these training or finetuning methods, our work shows that various natural language reasoning abilities can be elicited in off-theshelf language models of sufficient scale simply via prompting. This prompting setup is important because it allows for intermediate step reasoning without a large number of labeled annotations, and because a single model can perform a range of reasoning tasks without any gradient updates.

### [[b25-4]] D Appendix: Additional Analysis

[[b25-5]] D.1 Correct Chain of Thought Analysis

[[b25-6]] As mentioned in the main text, we analyze 50 chains of thought from LaMDA 137B that led to correct answers in the GSM8K dataset. Of these 50, only one arrived at the correct answer through incorrect reasoning (shown in Table 9: “correct by chance”). The other 49 had correct logic and math, with examples shown in Table 8. Five had minor imperfections while maintaining coherent and understandable logic:

[[b25-7]] • One had underspecified statements (shown in Table 9: “correct but underspecified statements”). • One made an unrelated but correct statement (shown in Table 9: “correct but unrelated statement”). • Two had the correct logic but omitted specific steps in the equation, though it was still understand-

[[b25-8]] able (shown in Table 9: “correct but imperfect equation”).

[[b25-9]] • One had the correct math but inverted the semantics (shown in Table 9: “correct but inverted

[[b25-10]] semantics”)

[[b25-11]] Table 8: Example of correct chains of thought produced by the model for the GSM8K dataset.

[[b25-12]] QUESTION: James decides to run 3 sprints 3 times a week. He runs 60 meters each sprint. How many total

[[b25-13]] meters does he run a week?

[[b25-14]] MODEL ANSWER (CORRECT): James decides to run 3 sprints 3 times a week. He runs 60 meters each

[[b25-15]] sprint. So he runs 60 meters x 3 sprints x 3 times a week. That is 60 meters x 9. The answer is 540. X

[[b25-16]] QUESTION: Brandon’s iPhone is four times as old as Ben’s iPhone. Ben’s iPhone is two times older than Suzy’s

[[b25-17]] iPhone. If Suzy’s iPhone is 1 year old, how old is Brandon’s iPhone?

[[b25-18]] MODEL ANSWER (CORRECT): Brandon’s iPhone is 4 times as old as Ben’s iPhone. Ben’s iPhone is 2

[[b25-19]] times older than Suzy’s iPhone. So Brandon’s iPhone is 4 x 2 = 8 times older than Suzy’s iPhone. Suzy’s iPhone

[[b25-20]] is 1 year old. So Brandon’s iPhone is 8 x 1 = 8 years old. The answer is 8. X

[[b25-21]] QUESTION: Jean has 30 lollipops. Jean eats 2 of the lollipops. With the remaining lollipops, Jean wants to

[[b25-22]] package 2 lollipops in one bag. How many bags can Jean fill?

[[b25-23]] MODEL ANSWER (CORRECT): Jean started with 30 lollipops. She ate 2 of them. So she has 28 lollipops

[[b25-24]] left. She wants to package 2 lollipops in one bag. So she can package 28 / 2 = 14 bags. The answer is 14. X

[[b25-25]] Although we find that chain-of-thought reasoning is mostly correct for math questions where the final answer was correct, this is likely because it is hard to arrive at the correct final answer by coincidence for free response questions. For multiple choice or binary classification problems, it was much more

[[b25-26]] 25

[[b26-1]] likely that models could arrive at the correct answer via an incorrect reasoning path (e.g., all the commmonsense reasoning datasets we evaluate). This is a limitation, and future work should perform an analysis of the factuality of such chains of thought.

[[b26-2]] Table 9: Of 50 examples that the model got correct, there were 7 salient cases where the chain of thought the model generated was imperfect. We found the other 43 to be equivalent to what a human would potentially generate as a ground truth.

[[b26-3]] QUESTION: There are 36 penguins sunbathing in the snow. One-third of them jump in and swim in the ocean. Another one-third go inside the cave to eat their dinner. How many penguins are still left sunbathing?

[[b26-4]] MODEL ANSWER (CORRECT BY CHANCE): There are 36 penguins. One-third of them jump in and swim in the ocean. So that is 12 penguins. Another one-third go inside the cave to eat their dinner. So that is 12 penguins. The answer is 12.

[[b26-5]] QUESTION: John has 2 houses with 3 bedrooms each. Each bedroom has 2 windows each. There are an additional 4 windows in each house not connected to bedrooms. How many total windows are there between the houses?

[[b26-6]] MODEL ANSWER (CORRECT BUT UNDERSPECIFIED STATEMENTS): There are 2 houses with 3 bedrooms each. Each bedroom has 2 windows each. So there are 2 x 3 = 6 windows in each house. There are an additional 4 windows in each house not connected to bedrooms. So there are 4 + 4 = 8 windows in each house. So there are 6 x 2 = 12 windows in each house. So there are 12 + 8 = 20 windows in both houses. The answer is 20.

[[b26-7]] QUESTION: If Ann is 9 years old and her brother is twice her age, how old will her brother be in 3 years?

[[b26-8]] MODEL ANSWER (CORRECT BUT UNRELATED STATEMENT): Ann is 9 years old. Her brother is twice her age. So her brother is 18 years old. In 3 years, she will be 12. So her brother will be 18 + 3 = 21 years old. The answer is 21.

[[b26-9]] QUESTION: A local gas station is selling gas for $3.00 a gallon. An app company is offering $.20 cashback per gallon if you fill up at this station. If someone buys 10 gallons of gas, how much with their gas be, after the cashback rewards?

[[b26-10]] MODEL ANSWER (CORRECT BUT IMPERFECT EQUATION): The gas is originally 3 dollars per gallon. If you buy 10 gallons, that is 3 x 10 = 30 dollars. If you get 20 cents off per gallon, that is 20 x 10 = 2 dollars. So the total is 30 - 2 = 28 dollars. The answer is 28 dollars.

[[b26-11]] QUESTION: Nissa hires 60 seasonal workers to play elves in her department store’s Santa village. A third of the elves quit after children vomit on them, then 10 of the remaining elves quit after kids kick their shins. How many elves are left?

[[b26-12]] MODEL ANSWER (CORRECT BUT IMPERFECT EQUATION): Nissa hires 60 seasonal workers. A third of them quit. So 60 - 1/3 = 40 elves are left. Then 10 elves quit. So 40 - 10 = 30 elves are left. The answer is 30 elves.

[[b26-13]] QUESTION: Grandma Jones baked 5 apple pies for the fireman’s luncheon. She cut each pie into 8 pieces and set the five pies out on the buffet table for the guests to serve themselves. At the end of the evening, after the guests had taken and eaten their pieces of pie, there were 14 pieces of pie remaining. How many pieces were taken by the guests?

[[b26-14]] MODEL ANSWER (CORRECT BUT INVERTED SEMANTICS): 5 pies were baked and cut into 8 pieces each. The 5 pies were then served to the guests. 8 x 5 = 40 pieces of pie. The guests ate 14 pieces of pie. 40 - 14 = 26 pieces of pie were left. The answer is 26. X

[[b26-15]] 26
