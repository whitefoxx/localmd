<!-- section 013 · pages 19–19 · raw/papers/chain-of-thought-prompting.pdf -->
# A.4 Why is prompting with the equation only not enough for some arithmetic reasoning datasets?

[[b19-1]] multi-step reasoning, (2) a large language model is used, and (3) the scaling curve is relatively flat. Conversely, the benefits are smaller when one or more of these conditions are not met. These intuitions are perhaps supported by the arithmetic reasoning results. The performance gain from chain-of-thought prompting is largest for PaLM 540B on GSM8K (challenging multi-step problems, flat scaling curve), which meets these conditions. The performance gain is small for the subsets of MAWPS that only require one or two steps (SingleOP, SingleEq, and AddSub), for which PaLM 540B already achieves performance of 90% or higher (and it is also generally true that there is less headroom for improvement when performance is already strong). Although in this paper we focused on multi-step reasoning tasks (arithmetic, commonsense, and symbolic), chain-of-thought prompting can potentially be applied to any task for which humans use a “chain of thought” to solve (at least in principle). We leave the empirical evaluation of chain-of-thought prompting on such diverse tasks (e.g., machine translation, etc.) to future work.

[[b19-2]] A.4 Why is prompting with the equation only not enough for some arithmetic reasoning datasets?

[[b19-3]] Prompting with the equation only as an intermediate step does help on many datasets, especially when the datasets only require a few reasoning steps (SVAMP, ASDiv, MAWPS). For GSM8K, however, using the equation only did not improve performance substantially. Based on qualitative analysis, we believe that these questions are too semantically challenging for the model to directly translate them into a math equation. Consider this example from LaMDA 137B:

[[b19-4]] QUESTION: Mike plays ping pong for 40 minutes. In the first 20 minutes, he scores 4 points. In the second 20 minutes, he scores 25% more points. How many total points did he score? EQUATION ONLY (WRONG ANSWER): (4 + 20 * 0.25) = 6. The answer is 6. CHAIN OF THOUGHT (CORRECT): Mike played ping pong for 40 minutes. In the first 20 minutes, he scored 4 points. In the second 20 minutes, he scored 25% more points. So he scored 25% more in the second 20 minutes. 4 x 1.25 = 5. So he scored 5 points in the second 20 minutes. So he scored 9 points in total. The answer is 9.

[[b19-5]] It is hard for the model to directly translate all of the semantics into a single equation, but chain of thought allows it to better reason about each part of the question via intermediate steps in natural language.

[[b19-6]] 19
