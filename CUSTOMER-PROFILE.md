# Editing a customer profile

Follows on from `EDIT-DELETE.md`, which gave the Customers **list** an Edit
button. This gives the customer's **own page** one, and finally makes true the
line that edit form has been showing all along:

> Addresses are managed on the customer's own page.

They were not. There was no way to edit an address anywhere in the app, from any
screen, even though the actions to do it had been sitting in the registry the
whole time.

## The bug underneath the feature

`customers.update` declared every field as `z.string().optional()`, and the form
sent `phone: f.phone || undefined`. So an empty box became `undefined`, Zod
dropped the key, Prisma never saw it, and the old value survived.

Clearing a wrong phone number told you **"Customer updated"** and changed
nothing. Reopen the form and it was back.

This is the same family as the `staff.update` + `colour` bug in `EDIT-DELETE.md`
— saved, reported, thrown away — and it was live on the list screen's Edit
button before this change.

`src/lib/schema.ts` already had `optionalText()`, but it means the opposite of
what an edit form needs: *blank = "I am not sending this field"*. That is right
for the AI assistant and wrong for a person who just emptied a box. So there is
now a third helper beside it:

| Helper | Blank string means |
|---|---|
| `optionalText()` | "not provided" — leave the column alone |
| `clearableText()` | "clear it" — write null |

`customers.update` and `customers.updateAddress` now use `clearableText()` for
every column that is nullable in the schema. The name and an address's `line1`
stay required-or-omitted, because a customer with no name and an address with no
street are not records worth having.

An omitted key still means "don't touch it", so nothing the assistant already
does changes.

## What the customer page can now do

| | |
|---|---|
| **Edit** | Name, phone, email, company, notes — clearing any of them works |
| **Deactivate / Reactivate** | Same action the list has, with a banner saying what it means |
| **Add address** | Label, both lines, city, state, postcode, access notes |
| **Edit address** | All of the above, each clearable |
| **Make primary** | One click from the address row |
| **Remove address** | Refused while a booking or job points at it |

Role gating matches the registry: all of this is **admin and owner**, because
that is what `customers.update`, `addAddress`, `updateAddress` and
`deleteAddress` each declare. Deleting the customer outright is still
**owner-only** and still lives on the list screen, which is where it was.

The profile form itself now lives in `src/components/CustomerForm.tsx` and both
screens use it. It was defined privately inside the list page before; the two
copies would have drifted, and the stale "managed on the customer's own page"
line is what drift looks like.

## One invariant, now held on purpose

Every customer in the database with addresses has exactly one primary — I
checked all 22. Nothing enforced it; it just happened to be true, because only
`customers.create` had ever made an address.

This feature is the first thing that could break it, in two ways: deleting the
primary, or adding a first address without ticking the box. Both are now handled
in the actions, so the AI assistant gets the same behaviour as the buttons:

- The **first** address a customer gets is primary whether or not anyone said so.
- Deleting the primary **promotes** the next oldest, and says so in the result.

## What I could and could not verify

I could not click any of it. The dev server on port 3100 belongs to another
session and is returning 500 on every route, I cannot stop it, and the app is
behind a sign-in I have no credentials for.

What I did instead: ran each action's **real input schema and real handler**
against the live database, on a throwaway customer that deletes itself
afterwards. Nothing existing was touched, and no stray rows remain — I checked.

All fifteen checks pass:

```
1. created             { phone: '0123', email: 'rt@example.com', company: 'Acme' }
2. cleared phone/email { phone: null, email: null, company: null, notes: 'kept' } PASS
3. set one, omit rest  { phone: '0199', notes: 'kept' }                           PASS
4. blank name refused                                                             PASS
5. deactivate hides    { withoutInactive: 0, withInactive: 1 }                    PASS
6. add + make primary  Home:false Office:true                                     PASS
7. edit + clear notes  { accessNotes: null, postcode: '93250' }                   PASS
8. primary moves over  Office:false Home:true                                     PASS
9. delete unused addr  { deleted: 'Office' }                                      PASS
10. in-use addr refused  "…is used by 1 booking(s)/job(s)…"                       PASS
11. delete w/ history    "…has 1 linked record(s)…"                               PASS
A. first address auto-primary                                                     PASS
B. second stays secondary                                                         PASS
C. primary promoted on delete  { deleted: 'Home', promotedToPrimary: 'Office' }   PASS
D. last address, no promote                                                       PASS
```

Checks 2 and 7 are the ones that matter — they are the bug at the top of this
file, in both places it lived.

So the server side is proven. **The buttons are not.** Worth clicking:

1. **A customer → Edit → empty the phone box → Save.** Reopen it. The box should
   still be empty. *(Do this one first; the toast is not evidence — it fires on
   any 200.)*
2. **Same customer → Edit → change the name → Save.** The page title should
   follow it without a reload.
3. **Add an address**, then **edit** it and clear the access notes.
4. **Make primary** on a second address. The badge should move, and the primary
   should sort to the top.
5. **Remove an address that a past job used.** Should refuse, and name the
   address and the count.
6. **Sign in as an ADMIN.** Edit, Deactivate and every address button should all
   still be there — none of this is owner-only.

## Why the primary address is worth the trouble

It is not decoration. `bookings.create` resolves an omitted address with

```ts
customer.addresses.find((a) => a.isPrimary)?.id ?? customer.addresses[0]?.id
```

and the booking form's address dropdown defaults to exactly that — its first
option is literally "Primary address". So the flag decides where a cleaner is
sent when nobody picks explicitly.

That is why deleting the primary now promotes a replacement rather than leaving
the fallback to pick whichever address the database happened to return first.

## Not done

Nothing here touches the **list** screen's own Edit button beyond the clearing
fix, and nothing changes how addresses behave on quotes. Say the word.
