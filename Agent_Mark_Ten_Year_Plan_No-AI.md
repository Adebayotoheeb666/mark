# Agent Mark: The Ten-Year Plan

### The "Keep-It-On-The-School-PC" Version, No AI Required

_No confusing business jargon. Just the real plan, explained the way you'd explain it to a smart friend who's never built a company before._

# Part 1: What Are We Even Building?

Imagine every school has a big notebook where all the students' grades, attendance, and report cards live. Right now, in most schools, that notebook is either a messy pile of paper and Excel sheets, or it's sitting on some company's server far away, a server the school doesn't own and can't peek inside.

**Here's the idea:** what if the notebook stayed at the school, on the school's own computer, and did the boring work automatically: adding up scores, working out grades and class positions, catching mistakes, and producing neat report cards, all without sending a single student's name or grade anywhere else?

That's Agent Mark, Local-First Version. The "engine" that reads scores, checks them against the school's rules, and builds report cards lives on a computer in the school's own admin office, not in some data center you'll never see. Teachers use their phones like little remote controls that talk to that school computer whenever they're nearby or connected.

**Quick definition: "local-first"**

_It just means: the important stuff (student data) lives locally, on a machine the school actually owns, before anything ever touches the internet. The internet is just used to help pass messages around, not to store the actual information._

## How does it work without being "smart"?

Agent Mark doesn't guess. It follows clear rules that the school can read and understand:

- **Calculating:** totals, averages, grades, and class positions are worked out by exact formulas. The same scores always give the same result.
- **Checking:** simple statistical rules catch mistakes, like a score higher than the maximum, a missing entry, or a mark that suddenly jumps far away from that student's own usual results. Flagged items wait for a teacher to confirm or correct them.
- **Writing comments:** teachers pick from a **comment bank**, a library of well-written sentences sorted by performance level, subject, trend, and tone. The system fills in the blanks (the student's name, the subject, the improvement), and the teacher can edit the wording before it goes out.
- **Producing report cards:** every number is pulled straight from the school's records into the report template, and the system refuses to produce a report where a number doesn't match the record.

Because every step follows a rule, a teacher or head of school can always see exactly _why_ a grade or a warning appeared. Nothing is a mystery.

## So where does the internet come in at all?

There's still a tiny cloud service involved, and you can think of it like a post office. If a teacher's phone can't reach the school computer directly (maybe they're at home, not at school), the phone sends a locked, sealed envelope to this "post office" in the cloud. The post office holds the sealed envelope for a little while and delivers it to the school computer the next time it checks in. Here's the important part: the post office can never open the envelope. It doesn't have the key. It just moves sealed mail around. After about a month, if nobody's picked it up, it just throws it away.

**This means:** even the company running that cloud "post office" can never see a single student's name, grade, or record. Not by accident, not if they wanted to, not even if someone hacked them, because the information they're holding is scrambled and they never had the key to unscramble it.

# Part 2: How Does Anyone Make Money From This?

This is the part that confuses people the most, so let's use something you already know: WhatsApp.

**WhatsApp doesn't read your private chats.** Your messages are scrambled the moment you hit send, and only your friend's phone can unscramble them. Not even WhatsApp's own servers can peek. And yet WhatsApp (owned by Meta) makes billions of dollars a year. How?

- They don't charge YOU, the person chatting with your friends.
- They charge BUSINESSES, like an airline sending you your boarding pass, or a shop confirming your order, a small fee every time they message a customer through WhatsApp.
- They also show ads on Instagram and Facebook that say "Message this business on WhatsApp," and they get paid for that ad, even though the conversation that follows is totally private.

**The lesson:** you don't need to read someone's private data to build a huge business around it. You make money at the edges, around the private stuff, not by spying on it.

## So how does Agent Mark make money the same way?

| **Money-Maker**             | **How It Works (in plain English)**                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **School subscription**     | Each school pays a yearly fee to use Agent Mark, like paying for Netflix, but for report cards. This covers setup, support, and updates.                                                                                                                                                                                                                                                                                                                       |
| **Rule and template packs** | Different countries, exam boards, and subjects need different grading scales, report layouts, comment banks, and common-error checklists. We build these as small downloadable packs that schools can add for an extra fee. As more schools use Agent Mark, the cloud can count _general_ patterns, like "lots of schools make this same data-entry mistake," without ever seeing any actual student's name or score, and we turn that into better checklists. |
| **Setup and hardware help** | Not every school has the right computer or knows how to set this up. We can charge for helping them get the right hardware and installing everything correctly, like how a phone company charges to set up your home WiFi.                                                                                                                                                                                                                                     |
| **Backup storage plan**     | Remember, we made a rule: every school MUST have a backup, and must prove it can restore from it before going live. We can offer a safe, scrambled, cloud backup service for a small monthly fee, like paying for extra iCloud storage, except we still can never read what's inside.                                                                                                                                                                          |

**The big idea to remember:** we never sell or peek at any student's actual data. We make money by selling the SERVICE (the software, the setup, the backup, the extra packs), never the DATA itself.

# Part 3: The Ten-Year Plan, Step by Step

Building any big thing works best when you don't try to do everything on day one. Here's how this grows, two years at a time.

## Years 1-2: Prove It Actually Works

We don't try to sell this to a thousand schools right away. First we build the single school computer's software properly, step by step, with every step independently checked by someone other than the builder. Then we find maybe 10 to 30 real schools willing to try it, our "guinea pigs," but the good kind, where they get something great for helping us test it.

- Before any real student data is touched, the system passes a full security review by an outside expert and a backup restore drill (we deliberately "break" a computer and prove we can bring everything back).
- We install Agent Mark on one computer in each school's office.
- Teachers get the app on their phones and start entering scores.
- Every report card gets checked and approved by a real teacher before it's sent out during the first grading period, because trust has to be earned, not assumed.
- We watch closely: does it actually save time? Do the checking rules catch real mistakes? Do teachers find the comment bank useful? Do parents like the reports?

**What success looks like:** a school that used to take 3 days to finish report cards now takes less than an hour, and not a single student's data ever left the building unscrambled.

## Years 3-4: Make It Easy to Install Anywhere

Once we know it works, we make it simple enough that a school's own IT person (or even a smart older student, honestly) can set it up without us holding their hand the whole time.

- We package the whole system so it installs in one go, like installing a new app, and we test that someone who isn't an engineer can do it alone.
- Because there's nothing heavy to run, an ordinary office computer is enough. No expensive special hardware is needed.
- We start charging real subscription fees. This is when it becomes an actual business, not just an experiment.
- The tiny cloud "post office" starts collecting its first bits of anonymous statistics (like "30% of schools using this made the same data-entry mistake"), never anything about a real student.

## Years 5-6: Schools Start Helping Each Other

This is the coolest part. Picture every school as a student in a classroom, and the cloud as a teacher who never gets to read anyone's actual homework, but still notices useful patterns by counting everyone's common mistakes, in a totally anonymous, blurred-together way.

**Example:** if 50 schools all tend to hit the same data-entry problem at the end of term, we can add a new check to the next update, and every school gets protected, without ever knowing which school had the problem, or about which student. In the same way, the most popular comment-bank sentences can be improved and shared back as a better pack.

- We only do this once enough schools are involved that no single school can be picked out of the numbers. If there aren't enough schools yet, we skip it and keep improving the packs by hand.
- More types of schools join: not just regular schools, but universities, training centers, and tutoring programs.
- The system keeps getting more useful for everyone, at the same time, without any school's private data ever being shared with another school.

## Years 7-8: Become the Gold Standard Everyone Trusts

By now, we're not just another app. We're the example people point to when they ask "what does doing this the RIGHT way even look like?"

- We publish, in plain language, exactly how the whole system works, so anyone (a parent, a government inspector, a journalist) can check our homework.
- We let independent outside experts audit us, and we're not scared of that, because the system was built to be provably safe from day one, not just "trust us."
- Governments and education regulators start pointing at us as the example other companies should copy.

**Why this matters more than it sounds**

_Anyone can SAY "we care about your privacy." We can actually PROVE it, because the cloud literally does not have the technical ability to read student data. It's not a promise, it's a fact about how the system is built. That's a much stronger thing to say to a worried parent or a strict regulator._

## Years 9-10: A Whole Ecosystem Grows Around It

At this point, other people start building ON TOP of what we made, like how thousands of people build apps for the iPhone without needing to build the iPhone itself.

- Schools can download packs built for their specific country's exam system, or their specific subject: grading scales, report templates, comment banks, and checklists.
- Other companies license our whole approach to build similar privacy-first systems for other things, like hospitals, law firms, and government offices: anywhere sensitive records and shaky internet meet.
- We're not just a product anymore. We're the blueprint other builders use.

# Part 4: The Trade-Offs, Explained Honestly

Nothing is free of downsides, and it's worth being honest about these.

**Trade-off 1: everything lives on one computer.** What happens if that computer breaks, gets stolen, or catches fire? That's why, right from day one, EVERY school is required to set up a backup, either a second computer on-site, or a scrambled backup sent to our cloud that even we can't read, just stored safely in case of an emergency. And the school can't go live until it has proven the backup actually restores.

It's a bit more work to set up than just "signing up for an account" the way you'd sign up for a normal app. But in exchange, you get something almost no cloud app can honestly promise: nobody, anywhere, except the school itself, can ever read a single student's private information.

**Trade-off 2: we have to win on trust and reliability, not on flashy features.** There are other school-records systems out there. Our advantage is that ours works without internet, keeps data at the school, and can prove it. So we sell those strengths hard, and we make sure the basics (correct calculations, clear checks, good templates, reliable backups, quick support) are excellent.

**Trade-off 3: comments are chosen, not invented.** Teachers pick and edit sentences from the comment bank instead of having them written from scratch. The upside is that teachers stay in full control of the wording, and the comments are always predictable and appropriate. We keep improving the bank based on what teachers actually use.

# The One-Sentence Summary

**If you remember nothing else**

_We build a reliable report-card system that lives at the school, never sends real student data anywhere, gets more useful over time by counting general patterns (not private details) across schools, and makes money the same way WhatsApp does: by charging for the service around the private data, never for the private data itself._