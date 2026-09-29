import assert from "node:assert/strict";
import test from "node:test";
import { bookingConfirmationMessage } from "../src/lib/payments/booking-confirmation-email";
test("booking confirmation distinguishes test payment and escapes customer-visible values",()=>{
 const data={to:"test@example.invalid",reference:"ST24-TEST",unit:"107<script>",amount:"2199.00",test:true};
 const message=bookingConfirmationMessage(data);
 assert.match(message.subject,/^\[TEST\]/);assert.match(message.text,/TEST — no money received/);assert.match(message.text,/2199.00/);assert.match(message.html,/107&lt;script&gt;/);assert.doesNotMatch(message.html,/<script>/);assert.match(message.text,/does not authorise key collection/);
 const live=bookingConfirmationMessage({...data,test:false});assert.doesNotMatch(live.subject,/\[TEST\]/);assert.match(live.text,/not a tax invoice/);assert.match(live.html,/View My STOR24/);
});
