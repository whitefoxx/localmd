<!-- section 021 · pages 35–41 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b35-1]] G Appendix: Full Prompts

[[b35-2]] Table 20: Few-shot exemplars for full chain of thought prompt for math word problems. This set of exemplars was used for all math word problem datasets except AQuA.

[[b35-3]] PROMPT FOR MATH WORD PROBLEMS Q: There are 15 trees in the grove. Grove workers will plant trees in the grove today. After they are done, there will be 21 trees. How many trees did the grove workers plant today? A: There are 15 trees originally. Then there were 21 trees after some more were planted. So there must have been 21 - 15 = 6. The answer is 6.

[[b35-4]] Q: If there are 3 cars in the parking lot and 2 more cars arrive, how many cars are in the parking lot? A: There are originally 3 cars. 2 more cars arrive. 3 + 2 = 5. The answer is 5.

[[b35-5]] Q: Leah had 32 chocolates and her sister had 42. If they ate 35, how many pieces do they have left in total? A: Originally, Leah had 32 chocolates. Her sister had 42. So in total they had 32 + 42 = 74. After eating 35, they had 74 - 35 = 39. The answer is 39.

[[b35-6]] Q: Jason had 20 lollipops. He gave Denny some lollipops. Now Jason has 12 lollipops. How many lollipops did Jason give to Denny? A: Jason started with 20 lollipops. Then he had 12 after giving some to Denny. So he gave Denny 20 - 12 = 8. The answer is 8.

[[b35-7]] Q: Shawn has five toys. For Christmas, he got two toys each from his mom and dad. How many toys does he have now? A: Shawn started with 5 toys. If he got 2 toys each from his mom and dad, then that is 4 more toys. 5 + 4 = 9. The answer is 9.

[[b35-8]] Q: There were nine computers in the server room. Five more computers were installed each day, from monday to thursday. How many computers are now in the server room? A: There were originally 9 computers. For each of 4 days, 5 more computers were added. So 5 * 4 = 20 computers were added. 9 + 20 is 29. The answer is 29.

[[b35-9]] Q: Michael had 58 golf balls. On tuesday, he lost 23 golf balls. On wednesday, he lost 2 more. How many golf balls did he have at the end of wednesday? A: Michael started with 58 golf balls. After losing 23 on tuesday, he had 58 - 23 = 35. After losing 2 more, he had 35 - 2 = 33 golf balls. The answer is 33.

[[b35-10]] Q: Olivia has $23. She bought five bagels for $3 each. How much money does she have left? A: Olivia had 23 dollars. 5 bagels for 3 dollars each will be 5 x 3 = 15 dollars. So she has 23 - 15 dollars left. 23 - 15 is 8. The answer is 8.

[[b35-11]] 35

[[b36-1]] Table 21: Few-shot exemplars for full chain of thought prompt for AQuA.

[[b36-2]] PROMPT FOR AQUA ALGEBRAIC WORD PROBLEMS Q: John found that the average of 15 numbers is 40. If 10 is added to each number then the mean of the numbers is? Answer Choices: (a) 50 (b) 45 (c) 65 (d) 78 (e) 64 A: If 10 is added to each number, then the mean of the numbers also increases by 10. So the new mean would be 50. The answer is (a).

[[b36-3]] Q: If a / b = 3/4 and 8a + 5b = 22,then find the value of a. Answer Choices: (a) 1/2 (b) 3/2 (c) 5/2 (d) 4/2 (e) 7/2 A: If a / b = 3/4, then b = 4a / 3. So 8a + 5(4a / 3) = 22. This simplifies to 8a + 20a / 3 = 22, which means 44a / 3 = 22. So a is equal to 3/2. The answer is (b).

[[b36-4]] Q: A person is traveling at 20 km/hr and reached his destiny in 2.5 hr then find the distance? Answer Choices: (a) 53 km (b) 55 km (c) 52 km (d) 60 km (e) 50 km A: The distance that the person traveled would have been 20 km/hr * 2.5 hrs = 50 km. The answer is (e).

[[b36-5]] Q: How many keystrokes are needed to type the numbers from 1 to 500? Answer Choices: (a) 1156 (b) 1392 (c) 1480 (d) 1562 (e) 1788 A: There are 9 one-digit numbers from 1 to 9. There are 90 two-digit numbers from 10 to 99. There are 401 three-digit numbers from 100 to 500. 9 + 90(2) + 401(3) = 1392. The answer is (b).

[[b36-6]] Table 22: Few-shot exemplars for full chain of thought prompt for the last letter concatenation task.

[[b36-7]] PROMPT FOR LAST LETTER CONCATENATION Q: Take the last letters of the words in "Elon Musk" and concatenate them. A: The last letter of "Elon" is "n". The last letter of "Musk" is "k". Concatenating them is "nk". The answer is nk.

[[b36-8]] Q: Take the last letters of the words in "Larry Page" and concatenate them. A: The last letter of "Larry" is "y". The last letter of "Page" is "e". Concatenating them is "ye". The answer is ye.

[[b36-9]] Q: Take the last letters of the words in "Sergey Brin" and concatenate them. A: The last letter of "Sergey" is "y". The last letter of "Brin" is "n". Concatenating them is "yn". The answer is yn.

[[b36-10]] Q: Take the last letters of the words in "Bill Gates" and concatenate them. A: The last letter of "Bill" is "l". The last letter of "Gates" is "s". Concatenating them is "ls". The answer is ls.

[[b36-11]] 36

[[b37-1]] Table 23: Few-shot exemplars for full chain of thought prompt for the coinflip task.

[[b37-2]] PROMPT FOR COIN FLIP Q: Q: A coin is heads up. Ka flips the coin. Sherrie flips the coin. Is the coin still heads up? A: The coin was flipped by Ka and Sherrie. So the coin was flipped 2 times, which is an even number. The coin started heads up, so after an even number of flips, it will still be heads up. So the answer is yes.

[[b37-3]] Q: A coin is heads up. Jamey flips the coin. Teressa flips the coin. Is the coin still heads up? A: The coin was flipped by Jamey and Teressa. So the coin was flipped 2 times, which is an even number. The coin started heads up, so after an even number of flips, it will still be heads up. So the answer is yes.

[[b37-4]] Q: A coin is heads up. Maybelle flips the coin. Shalonda does not flip the coin. Is the coin still heads up? A: The coin was flipped by Maybelle. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no.

[[b37-5]] Q: A coin is heads up. Millicent does not flip the coin. Conception flips the coin. Is the coin still heads up? A: The coin was flipped by Conception. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no.

[[b37-6]] Q: A coin is heads up. Sal flips the coin. Raymond does not flip the coin. Is the coin still heads up? A: The coin was flipped by Sal. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no.

[[b37-7]] Q: A coin is heads up. Conception flips the coin. Kristian does not flip the coin. Is the coin still heads up? A: The coin was flipped by Conception. So the coin was flipped 1 time, which is an odd number. The coin started heads up, so after an odd number of flips, it will be tails up. So the answer is no.

[[b37-8]] Q: A coin is heads up. Inga does not flip the coin. Elanor does not flip the coin. Is the coin still heads up? A: The coin was flipped by no one. So the coin was flipped 0 times. The coin started heads up, and it was not flipped, so it is still heads up. So the answer is yes.

[[b37-9]] Q: A coin is heads up. Ryan flips the coin. Shaunda flips the coin. Is the coin still heads up? A: The coin was flipped by Ryan and Shaunda. So the coin was flipped 2 times, which is an even number. The coin started heads up, so after an even number of flips, it will still be heads up. So the answer is yes.

[[b37-10]] 37

[[b38-1]] Table 24: Few-shot exemplars for full chain of thought prompt for CSQA. There are newlines between the answer choices that are omitted in the table for space reasons.

[[b38-2]] PROMPT FOR CSQA Q: What do people use to absorb extra ink from a fountain pen? Answer Choices: (a) shirt pocket (b) calligrapher’s hand (c) inkwell (d) desk drawer (e) blotter A: The answer must be an item that can absorb ink. Of the above choices, only blotters are used to absorb ink. So the answer is (e).

[[b38-3]] Q: What home entertainment equipment requires cable? Answer Choices: (a) radio shack (b) substation (c) television (d) cabinet A: The answer must require cable. Of the above choices, only television requires cable. So the answer is (c).

[[b38-4]] Q: The fox walked from the city into the forest, what was it looking for? Answer Choices: (a) pretty flowers (b) hen house (c) natural habitat (d) storybook A: The answer must be something in the forest. Of the above choices, only natural habitat is in the forest. So the answer is (b).

[[b38-5]] Q: Sammy wanted to go to where the people were. Where might he go? Answer Choices: (a) populated areas (b) race track (c) desert (d) apartment (e) roadblock A: The answer must be a place with a lot of people. Of the above choices, only populated areas have a lot of people. So the answer is (a).

[[b38-6]] Q: Where do you put your grapes just before checking out? Answer Choices: (a) mouth (b) grocery cart (c)super market (d) fruit basket (e) fruit market A: The answer should be the place where grocery items are placed before checking out. Of the above choices, grocery cart makes the most sense for holding grocery items. So the answer is (b).

[[b38-7]] Q: Google Maps and other highway and street GPS services have replaced what? Answer Choices: (a) united states (b) mexico (c) countryside (d) atlas A: The answer must be something that used to do what Google Maps and GPS services do, which is to give directions. Of the above choices, only atlases are used to give directions. So the answer is (d).

[[b38-8]] Q: Before getting a divorce, what did the wife feel who was doing all the work? Answer Choices: (a) harder (b) anguish (c) bitterness (d) tears (e) sadness A: The answer should be the feeling of someone getting divorced who was doing all the work. Of the above choices, the closest feeling is bitterness. So the answer is (c).

[[b38-9]] 38

[[b39-1]] Table 25: Few-shot exemplars for full chain of thought prompt for StrategyQA.

[[b39-2]] PROMPT FOR STRATEGYQA Q: Do hamsters provide food for any animals? A: Hamsters are prey animals. Prey are food for predators. Thus, hamsters provide food for some animals. So the answer is yes.

[[b39-3]] Q: Could Brooke Shields succeed at University of Pennsylvania? A: Brooke Shields went to Princeton University. Princeton University is about as academically rigorous as the University of Pennsylvania. Thus, Brooke Shields could also succeed at the University of Pennsylvania. So the answer is yes.

[[b39-4]] Q: Yes or no: Hydrogen’s atomic number squared exceeds number of Spice Girls? A: Hydrogen has an atomic number of 1. 1 squared is 1. There are 5 Spice Girls. Thus, Hydrogen’s atomic number squared is less than 5. So the answer is no.

[[b39-5]] Q: Yes or no: Is it common to see frost during some college commencements? A: College commencement ceremonies can happen in December, May, and June. December is in the winter, so there can be frost. Thus, there could be frost at some commencements. So the answer is yes.

[[b39-6]] Q: Yes or no: Could a llama birth twice during War in Vietnam (1945-46)? A: The War in Vietnam was 6 months. The gestation period for a llama is 11 months, which is more than 6 months. Thus, a llama could not give birth twice during the War in Vietnam. So the answer is no.

[[b39-7]] Q: Yes or no: Would a pear sink in water? A: The density of a pear is about 0.6g/cm3, which is less than water. Objects less dense than water float. Thus, a pear would float. So the answer is no.

[[b39-8]] Table 26: Few-shot exemplars for full chain of thought prompt for Date Understanding.

[[b39-9]] PROMPT FOR DATE UNDERSTANDING Q: 2015 is coming in 36 hours. What is the date one week from today in MM/DD/YYYY? A: If 2015 is coming in 36 hours, then it is coming in 2 days. 2 days before 01/01/2015 is 12/30/2014, so today is 12/30/2014. So one week from today will be 01/05/2015. So the answer is 01/05/2015.

[[b39-10]] Q: The first day of 2019 is a Tuesday, and today is the first Monday of 2019. What is the date today in MM/DD/YYYY? A: If the first day of 2019 was Tuesday, then 01/01/2019 was a Tuesday. Today is the first monday, would be six days later. So today is 01/07/2019. So the answer is 01/07/2019.

[[b39-11]] Q: The concert was scheduled to be on 06/01/1943, but was delayed by one day to today. What is the date 10 days ago in MM/DD/YYYY? A: One day after 06/01/1943 is 06/02/1943, so today is 06/02/1943. 10 days before today is 05/23/1943. So the answer is 05/23/1943.

[[b39-12]] Q: It is 4/19/1969 today. What is the date 24 hours later in MM/DD/YYYY? A: Today is 04/19/1969. 24 hours later is one day after today, which would be 04/20/1969. So the answer is 04/20/1969.

[[b39-13]] Q: Jane thought today is 3/11/2002, but today is in fact Mar 12, which is 1 day later. What is the date 24 hours later in MM/DD/YYYY? A: Today is 03/12/2002. So the date 24 hours later will be 03/13/2002. So the answer is 03/13/2002.

[[b39-14]] Q: Jane was born on the last day of Feburary in 2001. Today is her 16-year-old birthday. What is the date yesterday in MM/DD/YYYY? A: The last day of February is the 28th, so Jane was born on 02/28/2001. Today is her 16-year old birthday, so today is 02/28/2017. So yesterday was 02/27/2017. So the answer is 02/27/2017.

[[b39-15]] 39

[[b40-1]] Table 27: Few-shot exemplars for full chain of thought prompt for Sports Understanding.

[[b40-2]] PROMPT FOR SPORTS UNDERSTANDING Q: Is the following sentence plausible? “Kyle Palmieri was called for slashing.” A: Kyle Palmieri is a hockey player. Being called for slashing is part of hockey. So the answer is yes.

[[b40-3]] Q: Is the following sentence plausible? “Joao Moutinho caught the screen pass in the NFC championship.” A: Joao Moutinho is a soccer player. The NFC championship is part of American football, not soccer. So the answer is no.

[[b40-4]] Q: Is the following sentence plausible? “Carson Wentz set the pick and roll.” A: Carson Wentz is an American football player. Pick and roll is part of basketball, not football. So the answer is no.

[[b40-5]] Q: Is the following sentence plausible? “Jonas Valanciunas beat the buzzer.” A: Jonas Valanciunas is a basketball player. Beating the buzzer is part of basketball. So the answer is yes.

[[b40-6]] Q: Is the following sentence plausible? “Jamel Murray was perfect from the line.” A: Jamal Murray is a basketball player. Being perfect from the line is part of basketball. So the answer is yes.

[[b40-7]] Q: Is the following sentence plausible? “Sam Darnold passed the puck.” A: Sam Darnold is a American football player. Passing the puck is part of hockey, not American football. So the answer is no.

[[b40-8]] Q: Is the following sentence plausible? “Draymond Green threw a touchdown.” A: Draymond Green is an basketball player. Throwing a touchdown is part of football, not basketball. So the answer is no.

[[b40-9]] Q: Is the following sentence plausible? “Malcolm Brogdon banked the shot in.” A: Malcolm Brogdon is a basketball player. Banking the shot in is part of basketball. So the answer is yes.

[[b40-10]] 40

[[b41-1]] Table 28: Few-shot exemplars for full chain of thought prompt for SayCan robot planning tasks.

[[b41-2]] PROMPT FOR SAYCAN ROBOT PLANNING Locations = [counter, table, user, trash, bowl]. Objects = [7up, apple, kettle chips, tea, multigrain chips, coke, lime soda, jalapeno chips, rice chips, orange, grapefruit soda, pepsi, redbull, energy bar, sponge, water]. The robot can pick up items with pick(object) and put down items with put(object) as well as find objects or locations with find(). The robot can only understand the explicit locations and objects listed.

[[b41-3]] Human: I’m hungry, can you bring me some chips. Explanation: The user is hungry and has asked for chips. There are several types of chips available, I will bring the user the kettle chips. Plan: 1. find(kettle chips), 2. pick(kettle chips), 3. find(user), 4. put(kettle chips), 5. done().

[[b41-4]] Human: How would you move the grapefruit drink from the table to the counter? Explanation: The user has asked me to move the grapefruit drink to the counter. Plan: 1. find(grapefruit soda), 2. pick(grapefruit soda), 3. find(counter), 4. put(grapefruit soda), 5. done().

[[b41-5]] Human: How would you bring me some snacks? Explanation: The user has asked for snacks, I will choose two items and bring them. I will bring jalapeno chips and an apple. Plan: 1. find(jalapeno chips), 2. pick(jalapeno chips), 3. find(user), 4. put(jalapeno chips), 5. find(apple), 6. pick(apple), 7. find(user), 8. put(apple), 9. done().

[[b41-6]] Human: How would you bring me something to eat that isn’t a fruit? Explanation: The user has asked for a food that isn’t a fruit, I will bring an energy bar to them. Plan: 1. find(energy bar), 2. pick(energy bar), 3. find(user), 4. put(energy bar), 5. done().

[[b41-7]] Human: How would you put the rice chips in the bowl and then move the tea to the table? Explanation: The user has asked me to do two tasks, I will do one and then the other. Plan: 1. find(rice chips), 2. pick(rice chips), 3. find(bowl), 4. put(rice chips), 5. find(tea), 6. pick(tea), 7. find(table), 8. put(tea), 9. done().

[[b41-8]] Human: How would you throw away a redbull? Explanation: The user has asked me to throw away the redbull, I will move it to the trash. Plan: 1. find(redbull), 2. pick(redbull), 3. find(trash), 4. put(redbull), 5. done().

[[b41-9]] Human: Bring me a drink. Explanation: The user has asked for a drink and there are many options. I will bring them a water. Plan: 1. find(water), 2. pick(water), 3. find(user), 4. put(water), 5. done().

[[b41-10]] 41
