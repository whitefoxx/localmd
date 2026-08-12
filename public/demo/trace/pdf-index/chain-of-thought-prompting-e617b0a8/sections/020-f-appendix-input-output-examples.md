<!-- section 020 · pages 32–34 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b32-1]] F Appendix: Input/Output Examples

[[b32-2]] Table 13: Examples of correct and incorrect chains of thought produced by LaMDA 137B on the letter concatenation task.

[[b32-3]] QUESTION: Take the last letters of the words in “Waldo Schmidt” and concatenate them.

[[b32-4]] MODEL ANSWER (CORRECT): The last letter of “Waldo” is “o”. The last letter of “Schmidt” is “t”. Concatenating them is “ot”. So the answer is ot. X

[[b32-5]] QUESTION: Take the last letters of the words in “Daniel Friedman” and concatenate them.

[[b32-6]] MODEL ANSWER (INCORRECT): The last letter of “Daniel” is “l”. The last letter of “Friedman” is “m”. Concatenating them is “lm”. So the answer is lm. 7

[[b32-7]] Table 14: Examples of correct and incorrect chains of thought produced by LaMDA 137B on the coinflip task.

[[b32-8]] QUESTION: A coin is heads up. Andree flips the coin. Audrie does not flip the coin. Is the coin still heads up?

[[b32-9]] MODEL ANSWER (CORRECT): The coin was flipped by Andree. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no. X

[[b32-10]] QUESTION: A coin is heads up. Kristian does not flip the coin. Dallas does not flip the coin. Is the coin still heads up?

[[b32-11]] MODEL ANSWER (INCORRECT): The coin was flipped by Kristian. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no. 7

[[b32-12]] Table 15: Examples of correct and incorrect chains of thought produced by LaMDA 137B on CSQA.

[[b32-13]] QUESTION: When a person is beginning work, what are they building? Answer Choices: (a) time (b) accomplishing (c) working (d) momentum (e) tiredness

[[b32-14]] MODEL ANSWER (CORRECT): The answer must be something that is built. Of the above choices, only momentum is built. So the answer is (d). X

[[b32-15]] QUESTION: Where are you likely to find a hamburger? Answer Choices: (a) fast food restaurant (b) pizza (c) ground up dead cows (d) mouth (e) cow carcus

[[b32-16]] MODEL ANSWER (CORRECT): The answer must be a place where hamburgers are found. Of the above choices, only fast food restaurants serve hamburgers. So the answer is (a). X

[[b32-17]] QUESTION: Aside from water and nourishment what does your dog need? Answer Choices: (a) bone (b) charm (c) petted (d) lots of attention (e) walked

[[b32-18]] MODEL ANSWER (INCORRECT): The answer must be something that a dog needs. Of the above choices, only bone is something that a dog needs. So the answer is (a). 7 (Ground truth is (d).)

[[b32-19]] QUESTION: What are you waiting alongside with when you’re in a reception area? Answer Choices: (a) motel (b) chair (c) hospital (d) people (e) hotels

[[b32-20]] MODEL ANSWER (INCORRECT): The answer must be something that is waiting with you in a reception area. Of the above choices, only people are waiting with you in a reception area. So the answer is (e). 7 (Ground truth is (d).)

[[b32-21]] 32

[[b33-1]] Table 16: Examples of correct and incorrect chains of thought produced by LaMDA 137B on StrategyQA.

[[b33-2]] QUESTION: Will The Exorcist stimulate limbic system? MODEL ANSWER (CORRECT): The Exorcist is a horror movie. Horror movies are scary. The limbic system is involved in fear. Thus, The Exorcist will stimulate the limbic system. So the answer is yes. X

[[b33-3]] QUESTION: Was Jackson Pollock trained by Leonardo da Vinci? MODEL ANSWER (CORRECT): Leonardo da Vinci lived in the 15th century. Jackson Pollock lived in the 20th century. Thus, Jackson Pollock could not have been trained by Leonardo da Vinci. So the answer is no. X

[[b33-4]] QUESTION: Can Harry Potter book a flight on Asiana Airlines? MODEL ANSWER (INCORRECT): Harry Potter is a fictional character. Thus, Harry Potter can do anything. So the answer is yes. 7 (Ground truth is “no”.)

[[b33-5]] QUESTION: Would a sophist use an épée? MODEL ANSWER (INCORRECT): A sophist is a person who is skilled in the art of persuasion. An épée is a type of sword. Thus, a sophist could use an épée. So the answer is yes. 7 (Ground truth is “no”.)

[[b33-6]] Table 17: Examples of correct and incorrect chains of thought produced by LaMDA 137B on Date Understanding.

[[b33-7]] QUESTION: May 6, 1992 is like yesterday to Jane, but that is actually ten years ago. What is the date a month ago in MM/DD/YYYY? MODEL ANSWER (CORRECT): May 6, 1992 is ten years ago, so today is May 6, 2002. So a month ago will be April 6, 2002. So the answer is 04/06/2002. X

[[b33-8]] QUESTION: This is the last day of 1899. What is the date 24 hours later in MM/DD/YYYY? MODEL ANSWER (CORRECT): Today is 12/31/1899. 24 hours later will be 01/01/1900. So the answer is 01/01/1900. X

[[b33-9]] QUESTION: Jane scheduled 3 apointments with 5 poeple for tomorrow (Tue, 7/9/1972). What is the date one week ago from today in MM/DD/YYYY? MODEL ANSWER (INCORRECT): Tomorrow is 7/9/1972. One week ago from today is 7/2/1972. So the answer is 7/2/1972. 7 (Ground truth is 07/01/1972.)

[[b33-10]] QUESTION: Today is the palindrome day of 2020, because the MMDDYYYY format of the date is the same backwards as forwards. What is the date tomorrow in MM/DD/YYYY? MODEL ANSWER (INCORRECT): Today is 02/29/2020. Tomorrow will be 03/01/2020. So the answer is 03/01/2020. 7 (Ground truth is “02/03/2020”.)

[[b33-11]] Table 18: Examples of correct and incorrect chains of thought produced by LaMDA 137B on Sports Understanding.

[[b33-12]] QUESTION: Is the following sentence plausible? “Joao Moutinho was out at third.” MODEL ANSWER (CORRECT): Joao Moutinho is a soccer player. Being out at third is part of baseball, not soccer. So the answer is no. X

[[b33-13]] QUESTION: Is the following sentence plausible? “Malcolm Brogdon eurostepped to the basket in the NBA Championship.” MODEL ANSWER (CORRECT): Malcolm Brogdon is a basketball player. Eurostepping to the basket is part of basketball. So the answer is yes. X

[[b33-14]] QUESTION: Is the following sentence plausible? “Derrick White backhanded a shot.” MODEL ANSWER (INCORRECT): Derrick White is a basketball player. Backhanding a shot is part of basketball. So the answer is yes. 7 (Ground truth is “no”, backhanding a shot is part of hockey.)

[[b33-15]] QUESTION: Is the following sentence plausible? “Nazem Kadri was out at home.” MODEL ANSWER (INCORRECT): Nazem Kadri is a hockey player. Being out at home is part of hockey. So the answer is yes. 7 (Ground truth is “no”, being out at home is part of baseball.)

[[b33-16]] 33

[[b34-1]] Table 19: Examples of correct and incorrect chains of thought produced by PaLM 540B on SayCan robot planning tasks.

[[b34-2]] QUESTION: I spilled my coke on the table, could you throw it away and then bring me something to help clean? MODEL ANSWER (CORRECT): Explanation: The user has spilled their coke on the table. I will throw away the coke and then bring the user a sponge. Plan: find(coke), pick(coke), find(trash), put(coke), find(sponge), pick(sponge), find(table), put(sponge). X QUESTION: Could you compost that apple for me? MODEL ANSWER (CORRECT): Explanation: The user would like me to compost the apple. I will move the apple to the compost. Plan: find(apple), pick(apple), find(trash), put(apple). X QUESTION: Can you bring me a drink that is not coke? MODEL ANSWER (INCORRECT): Explanation: The user asked me to bring a drink that is not coke, I will bring a sprite. Plan: find(sprite), pick(sprite), find(user), put(sprite). 7 (Feasible answers including finding lime soda, pepsi, grapefruit soda or water, because there is no sprite in the scene as defined in Table 28.) QUESTION: Can you bring me something salty? MODEL ANSWER (INCORRECT): Explanation: The user would like something salty. There are several options in the objects list, so I will bring the user a lime soda. Plan: find(lime soda), pick(lime soda), find(user), put(lime soda). 7 (Feasible answers including finding chips. The model misidentify lime soda as salty.)

[[b34-3]] 34
