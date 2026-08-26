<!-- section 011 · pages 17–17 · raw/papers/chain-of-thought-prompting.pdf -->
# A.2 What is the role of prompt engineering?

[[b17-1]] Question Tracy used a piece of wire 4 feet long to support tomato plants in the garden. The wire was cut into pieces 6 inches long. How many pieces did she obtain?

[[b17-2]] Question

[[b17-3]] Tom's ship can travel at 10 miles per hour. He is sailing from 1 to 4 PM. He then travels back at a rate of 6 mph. How long does it take him to get back?

[[b17-4]] Question

[[b17-5]] Stephen placed an online order for groceries. His final bill came to $40.00. Because this was through a delivery vendor, they tacked on a 25% fee to his final total and charged him $3.00 in delivery fees. Stephen also added a $4.00 tip. After the extra fees, what was the final price of Stephen's groceries?

[[b17-6]] Question

[[b17-7]] There are four schools competing at a basketball tournament. Each school has sent a girls’ basketball team and a boys’ basketball team and each team has 5 players each. Each school has also sent a coach for each team. In total, how many people have all of the schools sent?

[[b17-8]] Figure 10: Examples of semantic understanding and one-step missing errors that were fixed by scaling PaLM from 62B to 540B.

[[b17-9]] A.2 What is the role of prompt engineering?

[[b17-10]] One of the key considerations of prompting is sensitivity to the exact prompt. There is no shortage of work showing that prompts affect language models in unexpected ways (Min et al., 2022). The general way that we created chain of thought annotations was by taking eight exemplars from the training set and decomposing the reasoning process into multiple steps leading to the final answer. Examples of chain of thought annotations are provided in Figure 3, with full prompts given in Appendix G. To analyze how sensitive chain of thought is to prompt engineering, we performed robustness experiments with respect to various factors.

[[b17-11]] • Different annotators. We first analyze robustness to three different annotators (Section 3.4 and Figure 6). Although there is notable variance in performance (which we will discuss later), chain of thought performed better than the baseline by a large margin for all three annotators on eight datasets in arithmetic, commonsense, and symbolic reasoning (Table 6 and Table 7). Similar to the annotation process in Cobbe et al. (2021), annotators were not given specific instructions about

[[b17-12]] 17

[[b17-13]] 62B Model Output

[[b17-14]] 540B Model Output

[[b17-15]] She cut the wire into 6 inch pieces.

[[b17-16]] The wire was 4 feet long. This

[[b17-17]] This means she got 4 * 6 = 24

[[b17-18]] means it was 4 * 12 = 48 inches

[[b17-19]] pieces. The answer is 24.

[[b17-20]] long. It was cut into pieces 6 inches

[[b17-21]] (Incorrect: semantic

[[b17-22]] long. This means she obtained 48 /

[[b17-23]] understanding error)

[[b17-24]] 6 = 8 pieces. The answer is 8.

[[b17-25]] (Correct)

[[b17-26]] 62B Model Output

[[b17-27]] 540B Model Output

[[b17-28]] He travels from 1 to 4 PM. That

[[b17-29]] He travels at 10 mph from 1 to 4

[[b17-30]] means he travels for 3 hours. He

[[b17-31]] PM. This means he travels 3 hours.

[[b17-32]] travels back at 6 mph. That means

[[b17-33]] 3 hours at 10 mph means he travels

[[b17-34]] he travels for 3 * 6 = 18 miles. The

[[b17-35]] 3 * 10 = 30 miles. He then travels

[[b17-36]] answer is 18. (Incorrect: semantic

[[b17-37]] back at 6 mph. This means he

[[b17-38]] understanding error)

[[b17-39]] travels 6 miles per hour. He has to

[[b17-40]] travel 30 miles, so it takes him 30 / 6

[[b17-41]] = 5 hours. The answer is 5.

[[b17-42]] (Correct)

[[b17-43]] 62B Model Output

[[b17-44]] 540B Model Output

[[b17-45]] The final price of Stephen's

[[b17-46]] Stephen's bill was $40.00. The

[[b17-47]] groceries was $40.00. The delivery

[[b17-48]] delivery vendor added 25% to the

[[b17-49]] vendor added 25% to the final total,

[[b17-50]] bill. This means the bill was

[[b17-51]] so the final total was 125% of

[[b17-52]] increased by 25% of $40.00. This is

[[b17-53]] $40.00. This means the final total

[[b17-54]] 0.25 * $40.00 = $10.00. The delivery

[[b17-55]] was 125% * $40.00 = $50.00. The

[[b17-56]] fee was $3.00. The tip was $4.00.

[[b17-57]] delivery vendor also charged $3.00

[[b17-58]] So the total bill was $40.00 + $10.00

[[b17-59]] in delivery fees. So the final price of

[[b17-60]] + $3.00 + 540b model $4.00 =

[[b17-61]] Stephen's groceries was $50.00 +

[[b17-62]] $57.00. The answer is 57. (Correct)

[[b17-63]] $3.00 = $53.00. The answer is

[[b17-64]] $53.00. (Incorrect: one step

[[b17-65]] missing error)

[[b17-66]] 62B Model Output

[[b17-67]] 540B Model Output

[[b17-68]] There are 4 schools. Each school

[[b17-69]] Each school has sent 2 teams, each

[[b17-70]] has sent a girls’ basketball team and

[[b17-71]] with 5 players. This means each

[[b17-72]] a boys’ basketball team. Each team

[[b17-73]] school has sent 2 * 5 = 10 players.

[[b17-74]] has 5 players each. That means

[[b17-75]] Each school has also sent 2

[[b17-76]] there are 4 * 2 * 5 = 40 players.

[[b17-77]] coaches. This means each school

[[b17-78]] Each team has a coach. That

[[b17-79]] has sent 10 + 2 = 12 people. There

[[b17-80]] means there are 40 + 4 = 44

[[b17-81]] are 4 schools, so in total all of the

[[b17-82]] coaches. The answer is 44.

[[b17-83]] schools have sent 4 * 12 = 48

[[b17-84]] (Incorrect: one step missing

[[b17-85]] people. The answer is 48. (Correct)

[[b17-86]] error)
