<!-- section 017 · pages 27–27 · raw/papers/chain-of-thought-prompting.pdf -->
# D.2 Incorrect Chain of Thought Analysis

[[b27-1]] D.2 Incorrect Chain of Thought Analysis

[[b27-2]] We also manually analyze 50 randomly sampled outputs of the model that were incorrect on GSM8K for LaMDA 137B. There are many ways that a chain of thought can be incorrect, making the design of error categorization non-trivial. We decided to categorize errors into what changes are needed to make the chain of thought correct, with the goal of elucidating how the model can be improved in the future.

[[b27-3]] We found that many chains of thought can be made correct with one of the following three classes of modification.

[[b27-4]] • Calculator error only. We found that 8% of the chains of thought were completely correct except for a calculator error—in other words, applying an external calculator to equations, as done in Cobbe et al. (2021), would make the chain of thought correct. An example of this type of error is shown in Table 10: “calculator error only”. Indeed, the solve rate of chain-of-thought prompting on for LaMDA 137B GSM8K went up from 14.3% to 17.3% when we added a Python program as an external calculator, as shown in Table 2. Also, 34% of the examples contained calculator errors in addition to other types of errors. However, we perform the rest of the error categorization independently of calculator errors.

[[b27-5]] • Symbol mapping error. We next found that 16% percent of the chains of thought were correct except for what we call symbol mapping errors. We define a symbol mapping error as when the chain of thought is correct except for the number symbols, and it could be made totally correct by modifying only the equations and not the words. As one might argue that they could simply place the correct final equation in any chain of thought, we constrain this category to chains of thought where the chain of thought can be modified to be a completely correct reasoning process (not just final answer). An example of this error category is shown in Table 10: “symbol mapping error”.

[[b27-6]] • One step missing error. Our next category of error is chains of thought which were correct except that they were missing a single step. In other words, these chains of thoughts could be rewritten to be correct by adding in an additional reasoning step that was missed by the model. An example of this error category is shown in Table 10: “one step missing error”. We found that 22% percent of the errors fell into this category.

[[b27-7]] Table 10: Example of incorrect chains of thought, categorized as described in Appendix D.2.

[[b27-8]] QUESTION: Dan plants 3 rose bushes. Each rose bush has 25 roses. Each rose has 8 thorns. How many thorns are there total?

[[b27-9]] MODEL ANSWER (INCORRECT; CALCULATOR ERROR ONLY): Dan plants 3 rose bushes. Each rose bush has 25 roses. Each rose has 8 thorns. So 3 x 25 x 8 = 300. The answer is 300. 7

[[b27-10]] EXPLANATION FOR ERROR CATEGORY: The produced chain of thought could be made correct just by running the equation through an external calculator, instead of asking the model to do the computation.

[[b27-11]] QUESTION: Jill gets paid $20 per hour to teach and $30 to be a cheerleading coach. If she works 50 weeks a year, 35 hours a week as a teacher and 15 hours a week as a coach, what’s her annual salary?

[[b27-12]] MODEL ANSWER (INCORRECT; SYMBOL MAPPING ERROR): Jill gets paid 20 dollars per hour to teach and 30 dollars per hour to be a cheerleading coach. If she works 50 weeks a year, 35 hours a week as a teacher and 15 hours a week as a coach, then she works 50 x 35 = 1750 hours as a teacher and 15 x 30 = 450 hours as a coach. So she works 1750 + 450 = 2200 hours. She gets paid 20 dollars per hour for 1750 hours and 30 dollars per hour for 450 hours. So her annual salary is 20 x 1750 + 30 x 450 = $36,500. The answer is $36,500. 7

[[b27-13]] EXPLANATION FOR ERROR CATEGORY: The model incorrectly mapped “15 x 30” instead of “15 x 50”, and the chain of thought would be made correct by fixing just that one change (with an external calculator).

[[b27-14]] QUESTION: Kelian has two recipes for preparing dishes, one having 20 instructions and the second one having twice as many instructions as the first one. How many instructions does Kelian have to read to prepare the two dishes?

[[b27-15]] MODEL ANSWER (INCORRECT; ONE STEP MISSING ERROR): Kelian has two recipes. One has 20 instructions. The other has twice as many instructions as the first one. So the second one has 40 instructions. So Kelian has to read 40 instructions to prepare the two dishes. The answer is 40. 7

[[b27-16]] EXPLANATION FOR ERROR CATEGORY: The model answer could be made correct just adding one additional step (in this case, adding 20 and 40).

[[b27-17]] 27
